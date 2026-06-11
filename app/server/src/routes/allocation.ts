import type { FastifyInstance } from "fastify";
import { allocationImportSchema, defaultCurrencyFor } from "../domain/validate.js";
import { assetKey } from "../domain/types.js";
import type { Asset, Currency, Position } from "../domain/types.js";
import { db, nowIso } from "../db/index.js";
import { assetsRepo } from "../repositories/assets.js";
import { positionsRepo } from "../repositories/positions.js";
import { settingsRepo } from "../repositories/settings.js";
import { transactionsRepo } from "../repositories/transactions.js";
import { recomputeDailyPnlForAsset } from "../services/history.js";
import { recomputePosition } from "../services/position.js";
import { requireUnlockedPreHandler } from "./authGuard.js";

const ALLOCATION_SCHEMA = "trackfolio.assetAllocation.v1";

type ImportRowStatus = "imported" | "skipped" | "failed";
type RecomputeStatus = "ok" | "skipped" | "failed";

interface AllocationImportRow {
  index: number;
  key: string;
  status: ImportRowStatus;
  asset_id?: string;
  position_id?: string | null;
  reason?: string;
}

interface AllocationRecomputeResult {
  asset_id: string;
  status: RecomputeStatus;
  rows: number;
  from: string | null;
  reason?: string;
}

function activePosition(positions: Position[]): Position | null {
  return positions.find((p) => p.quantity > 0) ?? null;
}

function positionByAssetId(positions: Position[]): Map<string, Position> {
  return new Map(positions.map((p) => [p.asset_id, p]));
}

async function recomputeHistorySafe(assetId: string): Promise<AllocationRecomputeResult> {
  try {
    return await recomputeDailyPnlForAsset(assetId);
  } catch (e) {
    return {
      asset_id: assetId,
      status: "failed",
      rows: 0,
      from: null,
      reason: e instanceof Error ? e.message : "unknown_error",
    };
  }
}

export async function allocationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/allocation/export", { preHandler: requireUnlockedPreHandler }, async (_req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const [assets, positions] = await Promise.all([assetsRepo.list(), positionsRepo.list()]);
    const positionByAsset = positionByAssetId(positions.filter((p) => p.quantity > 0));
    const holdings = assets
      .map((asset) => {
        const position = positionByAsset.get(asset.id);
        if (!position) return null;
        return {
          asset_type: asset.asset_type,
          market: asset.market,
          symbol: asset.symbol,
          name: asset.name,
          currency: asset.currency,
          exchange: asset.exchange,
          fund_type: asset.fund_type,
          quantity: position.quantity,
          avg_cost: position.avg_cost,
          total_fee: position.total_fee,
          opened_at: position.opened_at,
          tags: position.tags,
          note: position.note,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return {
      schema: ALLOCATION_SCHEMA,
      exported_at: nowIso(),
      settlement_currency: settingsRepo.getDisplay().settlement_currency,
      holdings,
    };
  });

  app.post("/api/allocation/import", { preHandler: requireUnlockedPreHandler }, async (req, reply) => {
    const parsed = allocationImportSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "参数校验失败", details: parsed.error.flatten() });
    }

    const touchedAssetIds = new Set<string>();
    const rows = await db.tx(async () => {
      const resultRows: AllocationImportRow[] = [];
      for (const [index, item] of parsed.data.holdings.entries()) {
        const key = assetKey(item);
        const existing = await assetsRepo.findByKey(item.asset_type, item.market, item.symbol);
        let asset: Asset;
        if (existing) {
          asset = existing;
        } else {
          asset = await assetsRepo.create({
            asset_type: item.asset_type,
            market: item.market,
            symbol: item.symbol,
            name: item.name,
            currency: item.currency ?? defaultCurrencyFor(item.market),
            exchange: item.exchange ?? null,
            fund_type: item.fund_type ?? (item.asset_type === "FUND" ? "otc" : null),
            quote_status: "unavailable",
          });
        }

        const currentActive = activePosition(await positionsRepo.listByAsset(asset.id));
        if (parsed.data.mode === "skip_existing" && currentActive) {
          resultRows.push({
            index,
            key,
            status: "skipped",
            asset_id: asset.id,
            position_id: currentActive.id,
            reason: "已存在活跃持仓",
          });
          continue;
        }

        await transactionsRepo.create({
          asset_id: asset.id,
          side: "BUY",
          quantity: item.quantity,
          price: item.avg_cost,
          fee: item.total_fee ?? 0,
          currency: asset.currency as Currency,
          trade_time: item.opened_at ?? null,
          note: item.note ?? "资产配置导入",
        });

        const position = await recomputePosition(asset.id);
        const patch: { tags?: string[]; note?: string | null } = {};
        if (item.tags && item.tags.length > 0) patch.tags = item.tags;
        if (item.note !== undefined) patch.note = item.note;
        const updatedPosition = position && Object.keys(patch).length > 0
          ? await positionsRepo.update(position.id, patch)
          : position;

        touchedAssetIds.add(asset.id);
        resultRows.push({
          index,
          key,
          status: "imported",
          asset_id: asset.id,
          position_id: updatedPosition?.id ?? null,
        });
      }
      return resultRows;
    });

    const recompute = [] as AllocationRecomputeResult[];
    for (const assetId of touchedAssetIds) recompute.push(await recomputeHistorySafe(assetId));

    return reply.code(201).send({
      imported: rows.filter((r) => r.status === "imported").length,
      skipped: rows.filter((r) => r.status === "skipped").length,
      failed: rows.filter((r) => r.status === "failed").length,
      rows,
      recompute,
    });
  });
}
