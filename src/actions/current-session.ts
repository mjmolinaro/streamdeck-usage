import {
  action,
  SingletonAction,
  type JsonObject,
  type KeyAction,
  type KeyDownEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import { getUsage } from "../usage.js";
import { formatPercent, formatResetsIn, renderError, renderKey, renderLoading } from "../render.js";
import { openSettings } from "../open-settings.js";

const REFRESH_MS = 3 * 60_000;

type Settings = JsonObject;

@action({ UUID: "com.aaronholt.claude-usage.current" })
export class CurrentSessionAction extends SingletonAction<Settings> {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    if (!ev.action.isKey()) return;
    await ev.action.setImage(renderLoading("SESSION"));
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

  override async onKeyDown(_ev: KeyDownEvent<Settings>): Promise<void> {
    await openSettings();
  }

  private async tick(action: KeyAction<Settings>): Promise<void> {
    const r = await getUsage();
    if (!r.ok) {
      await action.setImage(renderError("SESSION"));
      return;
    }
    const bucket = r.data.five_hour;
    if (!bucket || typeof bucket.utilization !== "number") {
      await action.setImage(renderError("SESSION"));
      return;
    }
    await action.setImage(
      renderKey({
        big: formatPercent(bucket.utilization),
        label: "SESSION",
        subtitle: formatResetsIn(bucket.resets_at),
        accent: bucket.utilization > 80,
      })
    );
  }
}
