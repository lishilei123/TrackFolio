import { db, nowIso } from "../db/index.js";
import type { Currency, DisplaySetting, PnlColorScheme } from "../domain/types.js";

interface DisplayRow {
  id: number;
  settlement_currency: Currency;
  show_original_currency: number;
  exchange_rate_provider: string;
  theme: "dark" | "light";
  quote_refresh_interval: number;
  pnl_color_scheme: PnlColorScheme;
  updated_at: string;
}

function toDisplaySetting(row: DisplayRow): DisplaySetting {
  return { ...row, show_original_currency: !!row.show_original_currency };
}

export interface UpdateDisplayInput {
  settlement_currency?: Currency;
  show_original_currency?: boolean;
  exchange_rate_provider?: string;
  theme?: "dark" | "light";
  quote_refresh_interval?: number;
  pnl_color_scheme?: PnlColorScheme;
}

// 显示设置只有一行且被盈亏计算等同步代码频繁读取，
// 这里缓存在内存，getDisplay() 保持同步；写入后刷新缓存。
let cache: DisplaySetting | null = null;

async function reload(): Promise<DisplaySetting> {
  const row = await db.get<DisplayRow>("SELECT * FROM display_settings WHERE id = 1");
  cache = toDisplaySetting(row as DisplayRow);
  return cache;
}

export const settingsRepo = {
  /** 应用启动时预热缓存（initDb 之后调用一次）。 */
  async load(): Promise<void> {
    await reload();
  },

  getDisplay(): DisplaySetting {
    if (!cache) throw new Error("显示设置缓存未初始化，请先调用 settingsRepo.load()");
    return cache;
  },

  async updateDisplay(input: UpdateDisplayInput): Promise<DisplaySetting> {
    const current = this.getDisplay();
    const merged = { ...current, ...input };
    await db.run(
      `UPDATE display_settings
         SET settlement_currency = ?, show_original_currency = ?, exchange_rate_provider = ?,
             theme = ?, quote_refresh_interval = ?, pnl_color_scheme = ?, updated_at = ?
       WHERE id = 1`,
      [
        merged.settlement_currency,
        merged.show_original_currency ? 1 : 0,
        merged.exchange_rate_provider,
        merged.theme,
        merged.quote_refresh_interval,
        merged.pnl_color_scheme,
        nowIso(),
      ],
    );
    return reload();
  },
};
