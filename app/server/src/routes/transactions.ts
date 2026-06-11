import type { FastifyInstance } from "fastify";
import {
  createBatchTransactionsSchema,
  createTransactionSchema,
  updateTransactionSchema,
} from "../domain/validate.js";
import { assetsRepo } from "../repositories/assets.js";
import { pendingSipRepo } from "../repositories/pendingSip.js";
import { positionsRepo } from "../repositories/positions.js";
import { transactionsRepo } from "../repositories/transactions.js";
import { recomputeDailyPnlForAsset } from "../services/history.js";
import { recomputePosition, validateCostFlow } from "../services/position.js";
import { invalidCostFlowReply, normalizeTradeTime, validateAssetCostFlow } from "./costFlow.js";
import { requireUnlockedPreHandler } from "./authGuard.js";

export async function transactionRoutes(app: FastifyInstance): Promise<void> {
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

  // 某资产的交易流水
  app.get("/api/assets/:id/transactions", { preHandler: requireUnlockedPreHandler }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await assetsRepo.get(id))) return reply.code(404).send({ error: "资产不存在" });
    return transactionsRepo.listByAsset(id);
  });

  // 录入一笔买入/卖出 → 自动重算持仓数量与加权平均成本
  app.post("/api/assets/:id/transactions", { preHandler: requireUnlockedPreHandler }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const asset = await assetsRepo.get(id);
    if (!asset) return reply.code(404).send({ error: "资产不存在" });

    const parsed = createTransactionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "参数校验失败", details: parsed.error.flatten() });
    }
    const body = parsed.data;
    const tradeTime = normalizeTradeTime(body.trade_time);

    const invalid = await validateAssetCostFlow(id, [{
      side: body.side,
      quantity: body.quantity,
      price: body.price,
      fee: body.fee ?? 0,
      trade_time: tradeTime,
    }]);
    if (invalid) return invalidCostFlowReply(invalid, reply);

    const tx = await transactionsRepo.create({
      asset_id: id,
      side: body.side,
      quantity: body.quantity,
      price: body.price,
      fee: body.fee ?? 0,
      currency: asset.currency,
      trade_time: tradeTime,
      note: body.note ?? null,
    });

    const position = await recomputePosition(id);
    // 首次建仓时把标签写入持仓元数据
    if (position && body.tags && body.tags.length > 0) {
      await positionsRepo.update(position.id, { tags: body.tags });
    }

    const historyRecompute = await recomputeHistorySafe(id);
    return reply.code(201).send({
      transaction: tx,
      position: (await positionsRepo.listByAsset(id))[0] ?? null,
      history_recompute: historyRecompute,
    });
  });

  // 批量录入（基金定投补录）→ 多期 BUY 一次落库，仅重算一次持仓与历史
  app.post("/api/assets/:id/transactions/batch", { preHandler: requireUnlockedPreHandler }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const asset = await assetsRepo.get(id);
    if (!asset) return reply.code(404).send({ error: "资产不存在" });

    const parsed = createBatchTransactionsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "参数校验失败", details: parsed.error.flatten() });
    }
    const { side = "BUY", transactions, pending, tags } = parsed.data;
    const transactionInputs = transactions.map((t) => ({
      asset_id: id,
      side,
      quantity: t.quantity,
      price: t.price,
      fee: t.fee ?? 0,
      currency: asset.currency,
      trade_time: normalizeTradeTime(t.trade_time),
      note: t.note ?? null,
    }));

    const invalid = await validateAssetCostFlow(id, transactionInputs);
    if (invalid) return invalidCostFlowReply(invalid, reply);

    const created = await transactionsRepo.createMany(
      transactionInputs,
    );

    // 净值待披露的定投期：存为「待确认」占位，由后台任务披露后自动折算补录
    const createdPending = pending && pending.length > 0
      ? await pendingSipRepo.createMany(
          pending.map((p) => ({
            asset_id: id,
            trade_time: p.trade_time, // 确认日
            nav_date: p.nav_date, // 申购日（净值对应日）
            sip_mode: p.sip_mode,
            per_value: p.per_value,
            fee: p.fee ?? 0,
            currency: asset.currency,
            tags: tags ?? null,
            note: p.note ?? null,
          })),
        )
      : [];

    const position = await recomputePosition(id);
    // 首次建仓时把标签写入持仓元数据
    if (position && tags && tags.length > 0) {
      await positionsRepo.update(position.id, { tags });
    }

    const historyRecompute = await recomputeHistorySafe(id);
    return reply.code(201).send({
      transactions: created,
      count: created.length,
      pending: createdPending,
      position: (await positionsRepo.listByAsset(id))[0] ?? null,
      history_recompute: historyRecompute,
    });
  });

  // 修改一笔交易 → 重算
  app.patch("/api/transactions/:id", { preHandler: requireUnlockedPreHandler }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const tx = await transactionsRepo.get(id);
    if (!tx) return reply.code(404).send({ error: "交易不存在" });

    const parsed = updateTransactionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "参数校验失败", details: parsed.error.flatten() });
    }

    const nextTradeTime =
      parsed.data.trade_time !== undefined ? normalizeTradeTime(parsed.data.trade_time) : tx.trade_time;
    const candidate = {
      ...tx,
      side: parsed.data.side ?? tx.side,
      quantity: parsed.data.quantity ?? tx.quantity,
      price: parsed.data.price ?? tx.price,
      fee: parsed.data.fee ?? tx.fee,
      trade_time: nextTradeTime,
      note: parsed.data.note !== undefined ? parsed.data.note : tx.note,
    };
    const txs = (await transactionsRepo.listByAsset(tx.asset_id)).map((item) => (item.id === id ? candidate : item));
    const invalid = validateCostFlow(txs);
    if (invalid) return invalidCostFlowReply(invalid, reply);

    const updated = (await transactionsRepo.update(id, {
      ...parsed.data,
      trade_time: parsed.data.trade_time !== undefined ? nextTradeTime : undefined,
    }))!;
    const position = await recomputePosition(updated.asset_id);
    const historyRecompute = await recomputeHistorySafe(updated.asset_id);
    return { transaction: updated, position, history_recompute: historyRecompute };
  });

  // 删除一笔交易 → 重算
  app.delete("/api/transactions/:id", { preHandler: requireUnlockedPreHandler }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const tx = await transactionsRepo.get(id);
    if (!tx) return reply.code(404).send({ error: "交易不存在" });
    await transactionsRepo.remove(id);
    const position = await recomputePosition(tx.asset_id);
    const historyRecompute = await recomputeHistorySafe(tx.asset_id);
    return { position, history_recompute: historyRecompute };
  });

  // 某资产的「待确认」定投占位（净值待披露，后台自动回填）
  app.get("/api/assets/:id/pending-sip", { preHandler: requireUnlockedPreHandler }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await assetsRepo.get(id))) return reply.code(404).send({ error: "资产不存在" });
    return pendingSipRepo.listByAsset(id);
  });

  // 删除一条「待确认」占位（占位未进持仓推算，无需重算）
  app.delete("/api/pending-sip/:id", { preHandler: requireUnlockedPreHandler }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await pendingSipRepo.get(id))) return reply.code(404).send({ error: "待确认记录不存在" });
    await pendingSipRepo.remove(id);
    return { ok: true };
  });
}
