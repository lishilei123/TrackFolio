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

function beijingDate(now = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00.000Z`);
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/** 由 range 关键字推算 from/to（YYYY-MM-DD），custom 用显式 from/to */
export function resolveRange(
  range: string | undefined,
  from: string | undefined,
  to: string | undefined,
  now = new Date(),
): { from: string; to: string } {
  const today = beijingDate(now);
  const toStr = to ?? today;
  if (range === "custom" && from) return { from, to: toStr };

  let start: string;
  switch (range) {
    case "7d":
      start = addDays(today, -6);
      break;
    case "ytd":
      start = `${today.slice(0, 4)}-01-01`;
      break;
    case "90d":
      start = addDays(today, -89);
      break;
    case "30d":
    default:
      start = addDays(today, -29);
      break;
  }
  return { from: from ?? start, to: toStr };
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
