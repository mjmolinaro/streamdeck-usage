# streamdeck-usage — project context for Claude

End-user docs live in `README.md`. This file is for AI-assistant context on top of that — the things you can't infer from code or README.

## What this is

A Stream Deck plugin (TypeScript → rollup → Node bundle) that shows Claude Code subscription usage on five keys. Maintained as a personal fork:

- `origin` = `mjmolinaro/streamdeck-usage` (Marc's fork — where work lands)
- `upstream` = `Darhkfox/streamdeckclaude` (sync source; itself a fork of Aaron Holt's original)

When syncing from upstream: fast-forward `main`, push to `origin`, then rebase feature branches onto the new `main`. The upstream and our `main` are linear by convention — never merge-commit a sync.

## Dev workflow

The installed plugin at `~/Library/Application Support/com.elgato.StreamDeck/Plugins/com.aaronholt.claude-usage.sdPlugin` is a **symlink** to this repo's `com.aaronholt.claude-usage.sdPlugin/` (set up via `npx streamdeck link`). Consequences:

- `npm run build` writes straight into the live install. No deploy step.
- `npm run watch` rebuilds on save *and* restarts the plugin (`streamdeck restart com.aaronholt.claude-usage`). Use this for active dev.
- For one-off code changes: `npm run build` → `npx streamdeck restart com.aaronholt.claude-usage`.
- For manifest/asset changes: full Stream Deck app restart (`osascript -e 'tell application "Elgato Stream Deck" to quit'`, then `open -a "Elgato Stream Deck"`). The app name on disk is `Elgato Stream Deck`, not `Stream Deck`.
- Stream Deck caches `manifest.json` at app launch — killing the plugin process picks up new `plugin.js` but the version label stays stale until full app restart.

The Elgato CLI is a devDependency (`@elgato/cli`); the `npm run watch` script depends on it being on PATH, which `npm run` provides.

## Build verification

- Authoritative: `npm run build` (rollup with `@rollup/plugin-typescript`).
- **Do not trust** raw `tsc --noEmit -p tsconfig.json` — it surfaces spurious `TS2614` "no exported member" errors against `@elgato/streamdeck` and bogus `TS4112` override errors across files we never touched. The rollup build resolves these correctly. Use rollup, not raw tsc, as the build gate.

## Credentials — read this before touching `src/usage.ts`

On darwin the plugin reads OAuth credentials from the macOS keychain first:
- Service: `"Claude Code-credentials"`
- Account: `userInfo().username`
- Falls back to `~/.claude/.credentials.json` on keychain miss or non-darwin.

The source that read the credentials (`credSource`) is tracked in a module-global so refreshed tokens write back to the same place. This is safe today only because `inflight` serializes `loadUsage` — there's no concurrent reader/writer. Don't introduce parallelism in `loadUsage` without rethinking that coupling.

**Known unresolved concern: rotating refresh-token race.** The plugin and Claude Code now share the same keychain entry and both write it. If Claude Code refreshes and rotates the refresh token, the plugin's in-memory token goes stale and its next refresh gets 4xx → 15-min cooldown. Worth knowing; not fixed.

## Refresh endpoint hazard

`refreshAccessToken` POSTs to `https://console.anthropic.com/v1/oauth/token`. The response **rotates the refresh token** (the new value is read at `body.refresh_token` and persisted). **Never call this endpoint from a test with Marc's real credentials** — a test run will corrupt the live token that Claude Code is using. If we ever write tests for the refresh state machine, the code needs a small seam (injectable `fetch` + clock) so the logic is unit-tested without the network.

## Test coverage

Zero. No test runner, no `tests/` dir, no test deps. New work is currently untested; the refresh/cooldown state machine is the highest-value target if we ever add a runner (vitest fits this TS/rollup setup).

## OAuth `client_id`

The refresh request must include `client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e"` — the public Claude Code client ID. Without it the endpoint returns 400. (Captured in `CLIENT_ID` in `src/usage.ts`; commit `bed2b31` is the fix history.)

## Things in the project root that are not source

- `com.aaronholt.claude-usage.sdPlugin/` — the plugin bundle dir. `bin/` and `logs/` inside it are gitignored (build artifacts and runtime logs). `manifest.json` and `imgs/` are tracked.
- `*.streamDeckPlugin` — packed plugin bundle, gitignored.
