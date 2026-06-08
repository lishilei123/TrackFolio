import { db, newId, nowIso } from "../db/index.js";
import type { Currency } from "../domain/types.js";

export type SipMode = "amount" | "shares";

/** 定投「待确认」占位记录：净值尚未披露的定投期，由后台任务在披露后折算份额、转为正式交易流水。 */
export interface PendingSipOrder {
  id: string;
  asset_id: string;
  side: "BUY";
  trade_time: string; // 份额确认日（yyyy-mm-dd，= 收益起算日）
  nav_date: string | null; // 申购成交日（净值对应日）；旧行为 null，回填时回退用 trade_time
  sip_mode: SipMode;
  per_value: number; // 每期金额（amount）或份额（shares）
  fee: number;
  currency: Currency;
  tags: string[] | null; // 首次建仓时套用
  note: string | null;
  created_at: string;
}

export interface NewPendingSipInput {
  asset_id: string;
  trade_time: string; // 份额确认日
  nav_date: string; // 申购成交日（净值对应日）
  sip_mode: SipMode;
  per_value: number;
  fee?: number;
  currency: Currency;
  tags?: string[] | null;
  note?: string | null;
}

interface PendingSipRow extends Omit<PendingSipOrder, "tags"> {
  tags: string | null;
}

function fromRow(row: PendingSipRow): PendingSipOrder {
  return { ...row, tags: row.tags ? (JSON.parse(row.tags) as string[]) : null };
}

export const pendingSipRepo = {
  async listByAsset(assetId: string): Promise<PendingSipOrder[]> {
    const rows = await db.all<PendingSipRow>(
      "SELECT * FROM pending_sip_orders WHERE asset_id = ? ORDER BY trade_time ASC, created_at ASC",
      [assetId],
    );
    return rows.map(fromRow);
  },

  /** 含待确认占位的去重 asset_id 列表（回填任务用） */
  async listAssetIds(): Promise<string[]> {
    const rows = await db.all<{ asset_id: string }>(
      "SELECT DISTINCT asset_id FROM pending_sip_orders",
    );
    return rows.map((r) => r.asset_id);
  },

  async get(id: string): Promise<PendingSipOrder | null> {
    const row = await db.get<PendingSipRow>("SELECT * FROM pending_sip_orders WHERE id = ?", [id]);
    return row ? fromRow(row) : null;
  },

  async create(input: NewPendingSipInput): Promise<PendingSipOrder> {
    const id = newId();
    const now = nowIso();
    await db.run(
      `INSERT INTO pending_sip_orders
         (id, asset_id, side, trade_time, nav_date, sip_mode, per_value, fee, currency, tags, note, created_at)
       VALUES (?, ?, 'BUY', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.asset_id,
        input.trade_time,
        input.nav_date,
        input.sip_mode,
        input.per_value,
        input.fee ?? 0,
        input.currency,
        input.tags && input.tags.length > 0 ? JSON.stringify(input.tags) : null,
        input.note ?? null,
        now,
      ],
    );
    return (await this.get(id))!;
  },

  async createMany(inputs: NewPendingSipInput[]): Promise<PendingSipOrder[]> {
    const created: PendingSipOrder[] = [];
    for (const input of inputs) created.push(await this.create(input));
    return created;
  },

  async remove(id: string): Promise<void> {
    await db.run("DELETE FROM pending_sip_orders WHERE id = ?", [id]);
  },
};
