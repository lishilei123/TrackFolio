import { db, newId, nowIso } from "../db/index.js";
import type { Asset, AssetType, Currency, Market, QuoteStatus } from "../domain/types.js";

interface AssetRow {
  id: string;
  asset_type: AssetType;
  market: Market;
  symbol: string;
  name: string;
  currency: Currency;
  exchange: string | null;
  fund_type: string | null;
  quote_status: QuoteStatus;
  created_at: string;
  updated_at: string;
}

function toAsset(row: AssetRow): Asset {
  return { ...row };
}

export interface NewAssetInput {
  asset_type: AssetType;
  market: Market;
  symbol: string;
  name: string;
  currency: Currency;
  exchange?: string | null;
  fund_type?: string | null;
  quote_status?: QuoteStatus;
}

export const assetsRepo = {
  async list(): Promise<Asset[]> {
    const rows = await db.all<AssetRow>("SELECT * FROM assets ORDER BY created_at ASC");
    return rows.map(toAsset);
  },

  async get(id: string): Promise<Asset | null> {
    const row = await db.get<AssetRow>("SELECT * FROM assets WHERE id = ?", [id]);
    return row ? toAsset(row) : null;
  },

  async findByKey(asset_type: AssetType, market: Market, symbol: string): Promise<Asset | null> {
    const row = await db.get<AssetRow>(
      "SELECT * FROM assets WHERE asset_type = ? AND market = ? AND symbol = ?",
      [asset_type, market, symbol],
    );
    return row ? toAsset(row) : null;
  },

  async create(input: NewAssetInput): Promise<Asset> {
    const id = newId();
    const now = nowIso();
    await db.run(
      `INSERT INTO assets
         (id, asset_type, market, symbol, name, currency, exchange, fund_type, quote_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.asset_type,
        input.market,
        input.symbol,
        input.name,
        input.currency,
        input.exchange ?? null,
        input.fund_type ?? null,
        input.quote_status ?? "unavailable",
        now,
        now,
      ],
    );
    return (await this.get(id))!;
  },

  async updateQuoteStatus(id: string, status: QuoteStatus): Promise<void> {
    await db.run("UPDATE assets SET quote_status = ?, updated_at = ? WHERE id = ?", [status, nowIso(), id]);
  },

  async remove(id: string): Promise<void> {
    await db.run("DELETE FROM assets WHERE id = ?", [id]);
  },
};
