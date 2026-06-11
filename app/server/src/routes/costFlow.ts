import type { FastifyReply } from "fastify";
import { transactionsRepo } from "../repositories/transactions.js";
import { validateCostFlow, type CostFlowTx } from "../services/position.js";

/** 未显式给出成交时间的交易，用当前时刻补全 */
export function normalizeTradeTime(value: string | null | undefined): string {
  return value ?? new Date().toISOString();
}

/**
 * 乐观校验：读取该资产现有流水，与待写入交易合并回放一遍，确认不会出现卖超等非法状态。
 * 读取与随后的写入不在同一事务内——单人自托管场景下并发写入极少，竞态风险可忽略，
 * 落库后仍会以 recomputePosition 的重算结果为准。
 */
export async function validateAssetCostFlow(assetId: string, nextTxs: CostFlowTx[]): Promise<string | null> {
  const existing = await transactionsRepo.listByAsset(assetId);
  return validateCostFlow([...existing, ...nextTxs]);
}

export function invalidCostFlowReply(reason: string, reply: FastifyReply) {
  if (reason === "sell_quantity_exceeds_position") {
    return reply.code(400).send({ error: "卖出数量超过可用持仓" });
  }
  return reply.code(400).send({ error: "交易流水不合法", reason });
}
