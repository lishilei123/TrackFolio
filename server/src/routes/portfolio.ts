import type { FastifyInstance } from "fastify";
import type { Currency } from "../domain/types.js";
import { CURRENCIES } from "../domain/types.js";
import { assetsRepo } from "../repositories/assets.js";
import { dailyPnlRepo } from "../repositories/dailyPnl.js";
import { positionsRepo } from "../repositories/positions.js";
import { quotesRepo } from "../repositories/quotes.js";
import { settingsRepo } from "../repositories/settings.js";
import { computeHolding, computeOverview } from "../services/pnl.js";
import { refreshAll } from "../services/refresh.js";
import { requireUnlockedPreHandler } from "./authGuard.js";

function resolveSettlement(q: unknown): Currency {
  const c = (q as { currency?: string })?.currency;
  if (c && CURRENCIES.includes(c as Currency)) return c as Currency;
  return settingsRepo.getDisplay().settlement_currency;
}

function previousCalendarDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function portfolioRoutes(app: FastifyInstance): Promise<void> {
  // 看板核心数据：总览 + 持仓明细（已折算结算币种）
  app.get("/api/portfolio", async (req) => {
    const settlement = resolveSettlement(req.query);
    const [assets, positions, quotes] = await Promise.all([
      assetsRepo.list(),
      positionsRepo.list(),
      quotesRepo.all(),
    ]);
    const assetById = new Map(assets.map((a) => [a.id, a]));
    const quoteByAsset = new Map(quotes.map((q) => [q.asset_id, q]));
    const yesterday = previousCalendarDate();
    // 昨日快照一次性按区间取回，避免逐持仓查询（对 PostgreSQL 减少往返）
    const yRows = await dailyPnlRepo.listRange(yesterday, yesterday);
    const yByAsset = new Map(yRows.map((r) => [r.asset_id, r]));

    const holdings = positions
      // 已清仓（数量为 0）的持仓归档隐藏，不在活跃看板展示；数据仍留库供历史追溯（需求 5.3 / 10.2）
      .filter((p) => p.quantity > 0)
      .map((p) => {
        const asset = assetById.get(p.asset_id);
        if (!asset) return null;
        return computeHolding(asset, p, quoteByAsset.get(asset.id) ?? null, settlement, yByAsset.get(asset.id) ?? null);
      })
      .filter((h): h is NonNullable<typeof h> => h !== null);

    const overview = computeOverview(holdings, settlement);
    return { overview, holdings };
  });

  // 手动刷新行情
  app.post("/api/refresh", { preHandler: requireUnlockedPreHandler }, async () => {
    return refreshAll();
  });
}
