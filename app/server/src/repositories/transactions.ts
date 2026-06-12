import { db, newId, nowIso } from "../db/index.js";
import type { Currency } from "../domain/types.js";

export type TxSide = "BUY" | "SELL";

export interface Transaction {
  id: string;
  asset_id: string;
  side: TxSide;
  quantity: number;
  price: number;
  fee: number;
  currency: Currency;
  trade_time: string;
  external_key: string | null;
  note: string | null;
  created_at: string;
}

export interface NewTransactionInput {
  asset_id: string;
  side: TxSide;
  quantity: number;
  price: number;
  fee?: number;
  currency: Currency;
  trade_time?: string | null;
  note?: string | null;
  created_at?: string;
}

export type UpdateTransactionInput = Partial<
  Pick<NewTransactionInput, "side" | "quantity" | "price" | "fee" | "trade_time" | "note">
>;

export const transactionsRepo = {
  /** 按交易时间排序（用于加权平均成本重算） */
  async listByAsset(assetId: string): Promise<Transaction[]> {
    return db.all<Transaction>(
      "SELECT * FROM transactions WHERE asset_id = ? ORDER BY trade_time ASC, created_at ASC, id ASC",
      [assetId],
    );
  },

  async listByAssetIds(assetIds: string[]): Promise<Map<string, Transaction[]>> {
    if (assetIds.length === 0) return new Map();
    const placeholders = assetIds.map(() => "?").join(", ");
    const rows = await db.all<Transaction>(
      `SELECT * FROM transactions
       WHERE asset_id IN (${placeholders})
       ORDER BY asset_id ASC, trade_time ASC, created_at ASC, id ASC`,
      assetIds,
    );

    const grouped = new Map<string, Transaction[]>();
    for (const row of rows) {
      const list = grouped.get(row.asset_id) ?? [];
      list.push(row);
      grouped.set(row.asset_id, list);
    }
    return grouped;
  },

  async get(id: string): Promise<Transaction | null> {
    const row = await db.get<Transaction>("SELECT * FROM transactions WHERE id = ?", [id]);
    return row ?? null;
  },

  async create(input: NewTransactionInput): Promise<Transaction> {
    const id = newId();
    const now = nowIso();
    const createdAt = input.created_at ?? now;
    await db.run(
      `INSERT INTO transactions
         (id, asset_id, side, quantity, price, fee, currency, trade_time, external_key, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [
        id,
        input.asset_id,
        input.side,
        input.quantity,
        input.price,
        input.fee ?? 0,
        input.currency,
        input.trade_time ?? createdAt,
        input.note ?? null,
        createdAt,
      ],
    );
    return (await this.get(id))!;
  },

  /** 批量创建（基金定投补录），按入参顺序逐笔落库 */
  async createMany(inputs: NewTransactionInput[]): Promise<Transaction[]> {
    const created: Transaction[] = [];
    const baseTime = Date.parse(nowIso());
    for (const [index, input] of inputs.entries()) {
      created.push(await this.create({ ...input, created_at: new Date(baseTime + index).toISOString() }));
    }
    return created;
  },

  async update(id: string, input: UpdateTransactionInput): Promise<Transaction | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const merged = {
      side: input.side ?? existing.side,
      quantity: input.quantity ?? existing.quantity,
      price: input.price ?? existing.price,
      fee: input.fee ?? existing.fee,
      trade_time: input.trade_time !== undefined ? (input.trade_time ?? nowIso()) : existing.trade_time,
      note: input.note !== undefined ? input.note : existing.note,
    };
    await db.run(
      `UPDATE transactions
         SET side = ?, quantity = ?, price = ?, fee = ?, trade_time = ?, note = ?
       WHERE id = ?`,
      [merged.side, merged.quantity, merged.price, merged.fee, merged.trade_time, merged.note, id],
    );
    return this.get(id);
  },

  async remove(id: string): Promise<void> {
    await db.run("DELETE FROM transactions WHERE id = ?", [id]);
  },

  async removeByAsset(assetId: string): Promise<void> {
    await db.run("DELETE FROM transactions WHERE asset_id = ?", [assetId]);
  },
};
