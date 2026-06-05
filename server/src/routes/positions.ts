import type { FastifyInstance } from "fastify";
import { closePositionSchema, updatePositionSchema } from "../domain/validate.js";
import { assetsRepo } from "../repositories/assets.js";
import { dailyPnlRepo } from "../repositories/dailyPnl.js";
import { positionsRepo } from "../repositories/positions.js";
import { transactionsRepo } from "../repositories/transactions.js";
import { recomputeDailyPnlForAsset } from "../services/history.js";
import { recomputePosition } from "../services/position.js";
import { requireUnlockedPreHandler } from "./authGuard.js";

export async function positionRoutes(app: FastifyInstance): Promise<void> {
  async function recomputeHistorySafe(assetId: string) {
    try {
      return await recomputeDailyPnlForAsset(assetId);
    } catch (e) {
      return {
        asset_id: assetId,
        status: "failed" as const,
        rows: 0,
        from: null,
        reason: e instanceof Error ? e.message : "unknown_error",
      };
    }
  }

  app.get("/api/positions", async () => positionsRepo.list());

  // 仅编辑持仓元数据（标签/备注/建仓日期）；数量与成本由交易流水推算
  app.patch("/api/positions/:id", { preHandler: requireUnlockedPreHandler }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = updatePositionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "参数校验失败", details: parsed.error.flatten() });
    }
    const updated = await positionsRepo.update(id, parsed.data);
    if (!updated) return reply.code(404).send({ error: "持仓不存在" });
    return updated;
  });

  // 清仓：按剩余数量记录一笔卖出，成本/数量随之重算（保留历史交易，需求 5.3）
  app.post("/api/positions/:id/close", { preHandler: requireUnlockedPreHandler }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const position = await positionsRepo.get(id);
    if (!position) return reply.code(404).send({ error: "持仓不存在" });
    if (position.quantity <= 0) return reply.code(400).send({ error: "该持仓已无可清数量" });

    const parsed = closePositionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "参数校验失败", details: parsed.error.flatten() });
    }
    const body = parsed.data;

    const asset = await assetsRepo.get(position.asset_id);
    const tx = await transactionsRepo.create({
      asset_id: position.asset_id,
      side: "SELL",
      quantity: position.quantity,
      price: body.price ?? 0,
      fee: body.fee ?? 0,
      currency: asset?.currency ?? "CNY",
      trade_time: body.trade_time ?? null,
      note: body.note ?? "清仓归档",
    });
    const updated = await recomputePosition(position.asset_id);
    const historyRecompute = await recomputeHistorySafe(position.asset_id);
    return { transaction: tx, position: updated, history_recompute: historyRecompute };
  });

  // 删除持仓：连同该资产交易流水一并删除（资产保留）
  app.delete("/api/positions/:id", { preHandler: requireUnlockedPreHandler }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const position = await positionsRepo.get(id);
    if (!position) return reply.code(404).send({ error: "持仓不存在" });
    await transactionsRepo.removeByAsset(position.asset_id);
    await dailyPnlRepo.removeByAsset(position.asset_id);
    await positionsRepo.remove(id);
    return reply.code(204).send();
  });
}
