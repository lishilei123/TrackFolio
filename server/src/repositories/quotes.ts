import { db } from "../db/index.js";
import type { MarketStatus, QuoteSnapshot, QuoteStatus } from "../domain/types.js";

export const quotesRepo = {
  async get(assetId: string): Promise<QuoteSnapshot | null> {
    const row = await db.get<QuoteSnapshot>("SELECT * FROM quote_snapshots WHERE asset_id = ?", [assetId]);
    return row ?? null;
  },

  async all(): Promise<QuoteSnapshot[]> {
    return db.all<QuoteSnapshot>("SELECT * FROM quote_snapshots");
  },

  async upsert(q: QuoteSnapshot): Promise<void> {
    await db.run(
      `INSERT INTO quote_snapshots
         (asset_id, latest_price, latest_nav, previous_close, pre_previous_close, previous_nav,
          nav_date, open, high, low, volume, change_amount, change_percent,
          market_status, quote_time, provider, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(asset_id) DO UPDATE SET
          latest_price = excluded.latest_price,
          latest_nav = excluded.latest_nav,
          previous_close = excluded.previous_close,
          pre_previous_close = excluded.pre_previous_close,
          previous_nav = excluded.previous_nav,
          nav_date = excluded.nav_date,
          open = excluded.open,
          high = excluded.high,
          low = excluded.low,
          volume = excluded.volume,
          change_amount = excluded.change_amount,
          change_percent = excluded.change_percent,
          market_status = excluded.market_status,
          quote_time = excluded.quote_time,
          provider = excluded.provider,
          status = excluded.status`,
      [
        q.asset_id,
        q.latest_price,
        q.latest_nav,
        q.previous_close,
        q.pre_previous_close,
        q.previous_nav,
        q.nav_date,
        q.open,
        q.high,
        q.low,
        q.volume,
        q.change_amount,
        q.change_percent,
        q.market_status,
        q.quote_time,
        q.provider,
        q.status,
      ],
    );
  },

  /** 行情服务失败时仅更新状态，保留最后成功数据（需求 5.4 降级要求） */
  async markStatus(assetId: string, status: QuoteStatus, marketStatus?: MarketStatus): Promise<void> {
    if (marketStatus) {
      await db.run("UPDATE quote_snapshots SET status = ?, market_status = ? WHERE asset_id = ?", [
        status,
        marketStatus,
        assetId,
      ]);
    } else {
      await db.run("UPDATE quote_snapshots SET status = ? WHERE asset_id = ?", [status, assetId]);
    }
  },
};
