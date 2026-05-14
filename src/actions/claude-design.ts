import {
  action,
  SingletonAction,
  type JsonObject,
  type KeyAction,
  type KeyDownEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import { getUsage, invalidateUsageCache } from "../usage.js";
import { formatPercent, formatResetsIn, renderError, renderKey, renderLoading } from "../render.js";
import { openSettings } from "../open-settings.js";

const REFRESH_MS = 10 * 60_000;

type Settings = JsonObject;

@action({ UUID: "com.aaronholt.claude-usage.claude-design" })
export class ClaudeDesignAction extends SingletonAction<Settings> {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    if (!ev.action.isKey()) return;
    await ev.action.setImage(renderLoading("DESIGN"));
    await this.tick(ev.action);
    const t = setInterval(() => {
      void this.tick(ev.action as KeyAction<Settings>);
    }, REFRESH_MS);
    this.timers.set(ev.action.id, t);
  }

  override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
    const t = this.timers.get(ev.action.id);
    if (t) clearInterval(t);
    this.timers.delete(ev.action.id);
  }

  override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
    invalidateUsageCache();
    if (ev.action.isKey()) void this.tick(ev.action);
    await openSettings();
  }

  private async tick(action: KeyAction<Settings>): Promise<void> {
    const r = await getUsage();
    if (!r.ok) {
      await action.setImage(renderError("DESIGN"));
      return;
    }
    const bucket = r.data.seven_day_omelette;
    const pct = bucket?.utilization ?? 0;
    await action.setImage(
      renderKey({
        big: formatPercent(pct),
        label: "7D DESIGN",
        subtitle: formatResetsIn(bucket?.resets_at) ?? formatResetsIn(r.data.seven_day?.resets_at),
        accent: pct > 80,
      })
    );
  }
}
