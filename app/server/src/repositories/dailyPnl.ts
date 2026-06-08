import { db, nowIso } from "../db/index.js";
import type { AssetType, Currency, Market } from "../domain/types.js";

/** 每日盈亏快照（对应需求 7.5 DailyPnL，原币存储，读取时折算） */
export interface DailyPnlRow {
  date: string; // YYYY-MM-DD
  asset_id: string;
  market: Market;
  asset_type: AssetType;
  quantity: number;
  close_price: number | null;
  nav: number | null;
  daily_pnl_amount: number | null;
  total_pnl_amount: number | null;
  currency: Currency;
  is_estimated: number; // 0 | 1
  created_at: string;
}

export type NewDailyPnl = Omit<DailyPnlRow, "created_at">;

async function upsertRow(row: NewDailyPnl): Promise<void> {
  await db.run(
    `INSERT INTO daily_pnl
       (date, asset_id, market, asset_type, quantity, close_price, nav,
        daily_pnl_amount, total_pnl_amount, currency, is_estimated, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date, asset_id) DO UPDATE SET
        market = excluded.market,
        asset_type = excluded.asset_type,
        quantity = excluded.quantity,
        close_price = excluded.close_price,
        nav = excluded.nav,
        daily_pnl_amount = excluded.daily_pnl_amount,
        total_pnl_amount = excluded.total_pnl_amount,
        currency = excluded.currency,
        is_estimated = excluded.is_estimated`,
    [
      row.date,
      row.asset_id,
      row.market,
      row.asset_type,
      row.quantity,
      row.close_price,
      row.nav,
      row.daily_pnl_amount,
      row.total_pnl_amount,
      row.currency,
      row.is_estimated,
      nowIso(),
    ],
  );
}

export const dailyPnlRepo = {
  async hasAny(): Promise<boolean> {
    const row = await db.get("SELECT 1 AS one FROM daily_pnl LIMIT 1");
    return !!row;
  },

  /** 按日期升序读取全部资产的快照 */
  async listAll(): Promise<DailyPnlRow[]> {
    return db.all<DailyPnlRow>("SELECT * FROM daily_pnl ORDER BY date ASC, asset_id ASC");
  },

  /** 按日期升序读取区间内全部资产的快照 */
  async listRange(from: string, to: string): Promise<DailyPnlRow[]> {
    return db.all<DailyPnlRow>(
      "SELECT * FROM daily_pnl WHERE date >= ? AND date <= ? ORDER BY date ASC, asset_id ASC",
      [from, to],
    );
  },

  /** 单资产区间快照 */
  async listByAsset(assetId: string, from: string, to: string): Promise<DailyPnlRow[]> {
    return db.all<DailyPnlRow>(
      "SELECT * FROM daily_pnl WHERE asset_id = ? AND date >= ? AND date <= ? ORDER BY date ASC",
      [assetId, from, to],
    );
  },

  /** 单资产在指定日期前最近的一条快照，用于昨日盈亏按真实历史持仓口径计算 */
  async latestBefore(assetId: string, beforeDate: string): Promise<DailyPnlRow | null> {
    const row = await db.get<DailyPnlRow>(
      "SELECT * FROM daily_pnl WHERE asset_id = ? AND date < ? ORDER BY date DESC LIMIT 1",
      [assetId, beforeDate],
    );
    return row ?? null;
  },

  /** 按 (date, asset_id) upsert，重复回填/重算同日只更新 */
  upsert(row: NewDailyPnl): Promise<void> {
    return upsertRow(row);
  },

  async upsertMany(rows: NewDailyPnl[]): Promise<void> {
    await db.tx(async () => {
      for (const r of rows) await upsertRow(r);
    });
  },

  async removeByAsset(assetId: string): Promise<void> {
    await db.run("DELETE FROM daily_pnl WHERE asset_id = ?", [assetId]);
  },

  async removeByAssetAndDate(assetId: string, date: string): Promise<void> {
    await db.run("DELETE FROM daily_pnl WHERE asset_id = ? AND date = ?", [assetId, date]);
  },

  async removeByDate(date: string): Promise<void> {
    await db.run("DELETE FROM daily_pnl WHERE date = ?", [date]);
  },

  /** daily_pnl 是交易流水 + 历史价格推导出的派生数据；重算时整资产替换避免旧区间残留 */
  async replaceByAsset(assetId: string, rows: NewDailyPnl[]): Promise<void> {
    await db.tx(async () => {
      await db.run("DELETE FROM daily_pnl WHERE asset_id = ?", [assetId]);
      for (const r of rows) await upsertRow(r);
    });
  },
};
