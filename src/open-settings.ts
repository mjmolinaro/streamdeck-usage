import streamDeck from "@elgato/streamdeck";

export const SETTINGS_URL = "https://claude.ai/settings/usage";

export async function openSettings(): Promise<void> {
  try {
    await streamDeck.system.openUrl(SETTINGS_URL);
  } catch (e) {
    streamDeck.logger.error(`openUrl failed: ${(e as Error).message}`);
  }
}
