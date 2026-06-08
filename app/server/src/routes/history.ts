import type { FastifyInstance } from "fastify";
import type { Currency } from "../domain/types.js";
import { CURRENCIES } from "../domain/types.js";
import { historyQuerySchema } from "../domain/validate.js";
import { settingsRepo } from "../repositories/settings.js";
import type { Granularity } from "../services/history.js";
import { backfillHistory, getHistory } from "../services/history.js";
import { requireUnlockedPreHandler } from "./authGuard.js";

function resolveSettlement(c: string | undefined): Currency {
  if (c && CURRENCIES.includes(c as Currency)) return c as Currency;
  return settingsRepo.getDisplay().settlement_currency;
}

/** 由 range 关键字推算 from/to（YYYY-MM-DD），custom 用显式 from/to */
function resolveRange(
  range: string | undefined,
  from: string | undefined,
  to: string | undefined,
): { from: string; to: string } {
  const today = new Date();
  const toStr = to ?? today.toISOString().slice(0, 10);
  if (range === "custom" && from) return { from, to: toStr };

  const start = new Date(today);
  switch (range) {
    case "7d":
      start.setDate(today.getDate() - 6);
      break;
    case "ytd":
      start.setMonth(0, 1);
      break;
    case "90d":
      start.setDate(today.getDate() - 89);
      break;
    case "30d":
    default:
      start.setDate(today.getDate() - 29);
      break;
  }
  return { from: from ?? start.toISOString().slice(0, 10), to: toStr };
}

export async function historyRoutes(app: FastifyInstance): Promise<void> {
  // 历史盈亏曲线（账户累计 + 每日，已折算结算币种）
  app.get("/api/history", { preHandler: requireUnlockedPreHandler }, async (req, reply) => {
    const parsed = historyQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "参数校验失败", details: parsed.error.flatten() });
    }
    const q = parsed.data;
    const settlement = resolveSettlement(q.currency);
    const { from, to } = resolveRange(q.range, q.from, q.to);
    const granularity: Granularity = q.granularity ?? "day";
    return getHistory({ from, to, granularity, settlement, asset_id: q.asset_id });
  });

  // 手动触发回填（调试用）
  app.post("/api/history/backfill", { preHandler: requireUnlockedPreHandler }, async (req) => {
    const days = Number((req.query as { days?: string })?.days) || 90;
    return backfillHistory(days);
  });
}
