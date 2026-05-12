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
import {
  formatPercent,
  formatUsedOfLimit,
  renderError,
  renderKey,
  renderLoading,
} from "../render.js";
import { openSettings } from "../open-settings.js";

const REFRESH_MS = 10 * 60_000;

type Settings = JsonObject;

@action({ UUID: "com.aaronholt.claude-usage.extra-usage" })
export class ExtraUsageAction extends SingletonAction<Settings> {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    if (!ev.action.isKey()) return;
    await ev.action.setImage(renderLoading("EXTRA"));
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
      await action.setImage(renderError("EXTRA"));
      return;
    }
    const e = r.data.extra_usage;
    if (!e || !e.is_enabled) {
      await action.setImage(
        renderKey({ big: "off", label: "EXTRA", subtitle: "not enabled" })
      );
      return;
    }
    const pct = e.utilization;
    await action.setImage(
      renderKey({
        big: formatPercent(pct),
        label: "EXTRA",
        subtitle: formatUsedOfLimit(e.used_credits, e.monthly_limit, e.currency),
        accent: pct > 80,
      })
    );
  }
}
