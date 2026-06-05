import { db, newId, nowIso } from "../db/index.js";
import type { Position } from "../domain/types.js";

interface PositionRow {
  id: string;
  asset_id: string;
  quantity: number;
  avg_cost: number;
  total_fee: number;
  opened_at: string | null;
  closed_at: string | null;
  tags: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

function toPosition(row: PositionRow): Position {
  let tags: string[] = [];
  try {
    tags = JSON.parse(row.tags) as string[];
  } catch {
    tags = [];
  }
  return { ...row, tags };
}

export interface NewPositionInput {
  asset_id: string;
  quantity: number;
  avg_cost: number;
  total_fee?: number;
  opened_at?: string | null;
  tags?: string[];
  note?: string | null;
}

export type UpdatePositionInput = Partial<
  Omit<NewPositionInput, "asset_id"> & { closed_at: string | null }
>;

export const positionsRepo = {
  async list(): Promise<Position[]> {
    const rows = await db.all<PositionRow>("SELECT * FROM positions ORDER BY created_at ASC");
    return rows.map(toPosition);
  },

  async listByAsset(assetId: string): Promise<Position[]> {
    const rows = await db.all<PositionRow>(
      "SELECT * FROM positions WHERE asset_id = ? ORDER BY created_at ASC",
      [assetId],
    );
    return rows.map(toPosition);
  },

  async get(id: string): Promise<Position | null> {
    const row = await db.get<PositionRow>("SELECT * FROM positions WHERE id = ?", [id]);
    return row ? toPosition(row) : null;
  },

  async create(input: NewPositionInput): Promise<Position> {
    const id = newId();
    const now = nowIso();
    await db.run(
      `INSERT INTO positions
         (id, asset_id, quantity, avg_cost, total_fee, opened_at, closed_at, tags, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      [
        id,
        input.asset_id,
        input.quantity,
        input.avg_cost,
        input.total_fee ?? 0,
        input.opened_at ?? null,
        JSON.stringify(input.tags ?? []),
        input.note ?? null,
        now,
        now,
      ],
    );
    return (await this.get(id))!;
  },

  async update(id: string, input: UpdatePositionInput): Promise<Position | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const merged: Position = {
      ...existing,
      quantity: input.quantity ?? existing.quantity,
      avg_cost: input.avg_cost ?? existing.avg_cost,
      total_fee: input.total_fee ?? existing.total_fee,
      opened_at: input.opened_at !== undefined ? input.opened_at : existing.opened_at,
      closed_at: input.closed_at !== undefined ? input.closed_at : existing.closed_at,
      tags: input.tags ?? existing.tags,
      note: input.note !== undefined ? input.note : existing.note,
    };
    await db.run(
      `UPDATE positions
         SET quantity = ?, avg_cost = ?, total_fee = ?, opened_at = ?, closed_at = ?,
             tags = ?, note = ?, updated_at = ?
       WHERE id = ?`,
      [
        merged.quantity,
        merged.avg_cost,
        merged.total_fee,
        merged.opened_at,
        merged.closed_at,
        JSON.stringify(merged.tags),
        merged.note,
        nowIso(),
        id,
      ],
    );
    return this.get(id);
  },

  async remove(id: string): Promise<void> {
    await db.run("DELETE FROM positions WHERE id = ?", [id]);
  },
};
