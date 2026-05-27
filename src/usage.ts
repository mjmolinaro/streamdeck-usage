import { execFile, spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { homedir, platform, userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import streamDeck from "@elgato/streamdeck";

const execFileAsync = promisify(execFile);

const CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");
// macOS keychain entry written by current Claude Code. The plugin reads
// from here first on darwin, falling back to the file for older Claude
// Code or non-macOS platforms.
const KEYCHAIN_SERVICE = "Claude Code-credentials";
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const REFRESH_URL = "https://console.anthropic.com/v1/oauth/token";
const BETA_HEADER = "oauth-2025-04-20";
const CACHE_TTL_MS = 3 * 60_000;
// Public OAuth client id used by Claude Code. Required field for refresh
// requests against console.anthropic.com.
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
// When refresh fails with a real auth/format error, wait this long before
// trying again. Keeps a broken token from hammering the refresh endpoint
// and getting us 429'd. Network errors don't trigger a cooldown.
const REFRESH_FAILURE_COOLDOWN_MS = 15 * 60_000;
// If the last successful fetch was longer than this ago, assume the machine
// just woke from sleep and clear any active cooldown so we can recover fast.
const SLEEP_GAP_MS = 30 * 60_000;

type Bucket = { utilization: number; resets_at: string | null } | null;

export type ExtraUsage = {
  is_enabled: boolean;
  monthly_limit: number;
  used_credits: number;
  utilization: number;
  currency: string;
} | null;

export type UsageResponse = {
  five_hour: Bucket;
  seven_day: Bucket;
  seven_day_sonnet: Bucket;
  seven_day_opus: Bucket;
  seven_day_omelette: Bucket;
  extra_usage: ExtraUsage;
};

type Credentials = {
  claudeAiOauth: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes?: string[];
    subscriptionType?: string;
    rateLimitTier?: string;
  };
};

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; reason: string };
export type Result<T> = Ok<T> | Err;

let cached: { value: Result<UsageResponse>; fetchedAt: number } | undefined;
let inflight: Promise<Result<UsageResponse>> | undefined;
let refreshCooldownUntil = 0;
let lastSuccessAt = 0;

// Track which source provided the credentials so refreshed tokens go back
// to the same place. Otherwise the plugin and Claude Code diverge.
type CredSource = "keychain" | "file";
let credSource: CredSource = "file";

async function readKeychainCredentials(): Promise<Credentials> {
  const { stdout } = await execFileAsync("/usr/bin/security", [
    "find-generic-password",
    "-s", KEYCHAIN_SERVICE,
    "-a", userInfo().username,
    "-w",
  ]);
  return JSON.parse(stdout.trim()) as Credentials;
}

async function writeKeychainCredentials(creds: Credentials): Promise<void> {
  // `-w` with no value makes `security` read the password from stdin instead
  // of argv, keeping the token out of the process table. It prompts twice for
  // confirmation, so feed the secret twice; JSON.stringify never emits a raw
  // newline, so the line delimiter is unambiguous.
  const secret = JSON.stringify(creds);
  await new Promise<void>((resolve, reject) => {
    const child = spawn("/usr/bin/security", [
      "add-generic-password",
      "-s", KEYCHAIN_SERVICE,
      "-a", userInfo().username,
      "-U",
      "-w",
    ]);
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`security exited with code ${code}`)),
    );
    child.stdin.write(`${secret}\n${secret}\n`);
    child.stdin.end();
  });
}

async function readFileCredentials(): Promise<Credentials> {
  const raw = await readFile(CREDENTIALS_PATH, "utf8");
  return JSON.parse(raw) as Credentials;
}

async function writeFileCredentials(creds: Credentials): Promise<void> {
  await writeFile(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), "utf8");
}

async function readCredentials(): Promise<Credentials> {
  if (platform() === "darwin") {
    try {
      const creds = await readKeychainCredentials();
      if (creds.claudeAiOauth) {
        credSource = "keychain";
        return creds;
      }
    } catch {
      // Keychain miss or access denied — fall through to file.
    }
  }

  const creds = await readFileCredentials();
  if (!creds.claudeAiOauth) {
    throw new Error(
      "no claudeAiOauth in credentials — run `claude auth login --claudeai` to sign in to a Claude subscription",
    );
  }
  credSource = "file";
  return creds;
}

async function writeCredentials(creds: Credentials): Promise<void> {
  if (credSource === "keychain") {
    await writeKeychainCredentials(creds);
  } else {
    await writeFileCredentials(creds);
  }
}

async function refreshAccessToken(creds: Credentials): Promise<Credentials> {
  if (Date.now() < refreshCooldownUntil) {
    const wait = Math.round((refreshCooldownUntil - Date.now()) / 1000);
    throw new Error(`refresh on cooldown for ${wait}s — re-launch Claude Code to repair credentials`);
  }
  let res: Response;
  try {
    res = await fetch(REFRESH_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: creds.claudeAiOauth.refreshToken,
        client_id: CLIENT_ID,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    // Network error / timeout — likely a transient post-wake hiccup.
    // Don't apply the long cooldown; let the next tick retry naturally.
    throw new Error(`refresh network error: ${(e as Error).message}`);
  }
  if (res.status >= 400 && res.status < 500) {
    // Genuine auth/format problem — cooldown is appropriate.
    refreshCooldownUntil = Date.now() + REFRESH_FAILURE_COOLDOWN_MS;
    throw new Error(`refresh failed: HTTP ${res.status} ${await res.text()}`);
  }
  if (!res.ok) {
    // 5xx — server-side blip, treat as transient (no cooldown).
    throw new Error(`refresh server error: HTTP ${res.status}`);
  }
  const body = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  const updated: Credentials = {
    claudeAiOauth: {
      ...creds.claudeAiOauth,
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: Date.now() + body.expires_in * 1000,
    },
  };
  await writeCredentials(updated);
  refreshCooldownUntil = 0;
  streamDeck.logger.info("usage: refreshed OAuth access token");
  return updated;
}

async function fetchOnce(token: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(USAGE_URL, {
    headers: {
      authorization: `Bearer ${token}`,
      "anthropic-beta": BETA_HEADER,
    },
    signal: AbortSignal.timeout(15_000),
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { status: res.status, body };
}

async function loadUsage(): Promise<Result<UsageResponse>> {
  let creds: Credentials;
  try {
    creds = await readCredentials();
  } catch (e) {
    return { ok: false, reason: `cannot read credentials: ${(e as Error).message}` };
  }

  const expired = creds.claudeAiOauth.expiresAt - Date.now() < 60_000;
  if (expired) {
    try {
      creds = await refreshAccessToken(creds);
    } catch (e) {
      return { ok: false, reason: `refresh: ${(e as Error).message}` };
    }
  }

  let res = await fetchOnce(creds.claudeAiOauth.accessToken);
  if (res.status === 401) {
    try {
      creds = await refreshAccessToken(creds);
      res = await fetchOnce(creds.claudeAiOauth.accessToken);
    } catch (e) {
      return { ok: false, reason: `401 then refresh: ${(e as Error).message}` };
    }
  }
  if (res.status === 429) {
    return { ok: false, reason: "rate_limited" };
  }
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, reason: `HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}` };
  }
  return { ok: true, data: res.body as UsageResponse };
}

export function invalidateUsageCache(): void {
  cached = undefined;
  refreshCooldownUntil = 0;
}

export async function getUsage(): Promise<Result<UsageResponse>> {
  const now = Date.now();
  // If the last good fetch was a long time ago we probably just woke from
  // sleep. Drop any active cooldown so the next call retries immediately.
  if (lastSuccessAt > 0 && now - lastSuccessAt > SLEEP_GAP_MS && refreshCooldownUntil > now) {
    streamDeck.logger.info("usage: long gap since last success, clearing refresh cooldown");
    refreshCooldownUntil = 0;
  }
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached.value;
  if (inflight) return inflight;

  inflight = loadUsage().then((value) => {
    if (value.ok) lastSuccessAt = Date.now();
    // Only overwrite cache on success, or if there's no prior good value
    if (value.ok || !cached?.value.ok) {
      cached = { value, fetchedAt: Date.now() };
    } else {
      // Keep serving the stale-but-good value if the latest call failed
      cached = { value: cached.value, fetchedAt: Date.now() - CACHE_TTL_MS + 60_000 };
    }
    return value;
  });

  try {
    return await inflight;
  } finally {
    inflight = undefined;
  }
}

export async function verifyUsage(): Promise<void> {
  const r = await getUsage();
  if (r.ok) streamDeck.logger.info(`usage probe ok (five_hour=${r.data.five_hour?.utilization})`);
  else streamDeck.logger.error(`usage probe failed: ${r.reason}`);
}
