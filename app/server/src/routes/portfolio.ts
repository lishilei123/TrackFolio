import type { FastifyInstance } from "fastify";
import type { Currency } from "../domain/types.js";
import { CURRENCIES } from "../domain/types.js";
import { assetsRepo } from "../repositories/assets.js";
import { dailyPnlRepo } from "../repositories/dailyPnl.js";
import { positionsRepo } from "../repositories/positions.js";
import { quotesRepo } from "../repositories/quotes.js";
import { settingsRepo } from "../repositories/settings.js";
import { transactionsRepo } from "../repositories/transactions.js";
import { computeHolding, computeOverview, currentSettlementDate } from "../services/pnl.js";
import { refreshAll } from "../services/refresh.js";
import { requireUnlockedPreHandler } from "./authGuard.js";

function resolveSettlement(q: unknown): Currency {
  const c = (q as { currency?: string })?.currency;
  if (c && CURRENCIES.includes(c as Currency)) return c as Currency;
  return settingsRepo.getDisplay().settlement_currency;
}

function previousSettlementDate(): string {
  const d = new Date(Date.parse(`${currentSettlementDate()}T00:00:00.000Z`) - 86_400_000);
  return d.toISOString().slice(0, 10);
}

export async function portfolioRoutes(app: FastifyInstance): Promise<void> {
  // 看板核心数据：总览 + 持仓明细（已折算结算币种）
  app.get("/api/portfolio", async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const settlement = resolveSettlement(req.query);
    const [assets, positions, quotes] = await Promise.all([
      assetsRepo.list(),
      positionsRepo.list(),
      quotesRepo.all(),
    ]);
    const assetById = new Map(assets.map((a) => [a.id, a]));
    const quoteByAsset = new Map(quotes.map((q) => [q.asset_id, q]));
    const today = currentSettlementDate();
    const yesterday = previousSettlementDate();
    // 今日/昨日结算快照一次性按区间取回，避免逐持仓查询（对 PostgreSQL 减少往返）
    const pnlRows = await dailyPnlRepo.listRange(yesterday, today);
    const todayByAsset = new Map(pnlRows.filter((r) => r.date === today).map((r) => [r.asset_id, r]));
    const yByAsset = new Map(pnlRows.filter((r) => r.date === yesterday).map((r) => [r.asset_id, r]));
    const activePositions = positions.filter((p) => p.quantity > 0);
    const txByAsset = await transactionsRepo.listByAssetIds(activePositions.map((p) => p.asset_id));

    const holdings = activePositions
      // 已清仓（数量为 0）的持仓归档隐藏，不在活跃看板展示；数据仍留库供历史追溯（需求 5.3 / 10.2）
      .map((p) => {
        const asset = assetById.get(p.asset_id);
        if (!asset) return null;
        return computeHolding(
          asset,
          p,
          quoteByAsset.get(asset.id) ?? null,
          settlement,
          todayByAsset.get(asset.id) ?? null,
          yByAsset.get(asset.id) ?? null,
          txByAsset.get(asset.id) ?? [],
        );
      })
      .filter((h): h is NonNullable<typeof h> => h !== null);

    // 当天清仓（数量归零但昨日仍持有，存在昨日快照）的资产：昨日盈亏仍需计入总览，
    // 与历史走势图口径一致（需求 5.7.2）。这些资产不进入活跃持仓列表，仅供总览昨日盈亏汇总。
    const closedWithYesterday = positions.filter((p) => p.quantity <= 0 && yByAsset.has(p.asset_id));
    const archivedTxByAsset = closedWithYesterday.length
      ? await transactionsRepo.listByAssetIds(closedWithYesterday.map((p) => p.asset_id))
      : new Map();
    const archivedHoldings = closedWithYesterday
      .map((p) => {
        const asset = assetById.get(p.asset_id);
        if (!asset) return null;
        return computeHolding(
          asset,
          p,
          quoteByAsset.get(asset.id) ?? null,
          settlement,
          null,
          yByAsset.get(asset.id) ?? null,
          archivedTxByAsset.get(asset.id) ?? [],
        );
      })
      .filter((h): h is NonNullable<typeof h> => h !== null);

    const overview = computeOverview(holdings, settlement, archivedHoldings);
    return { overview, holdings };
  });

  // 手动刷新行情
  app.post("/api/refresh", { preHandler: requireUnlockedPreHandler }, async () => {
    return refreshAll();
  });
}
