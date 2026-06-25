import type { Asset, Currency } from "../domain/types.js";
import { assetsRepo } from "../repositories/assets.js";
import { positionsRepo } from "../repositories/positions.js";
import { transactionsRepo } from "../repositories/transactions.js";
import { fxService } from "./fx.js";
import { walkRealized, type RealizedLot } from "./position.js";

const EPS = 1e-9;

export interface RealizedAssetSummary {
  asset: Asset;
  currency: Currency;
  /** 是否已清仓（数量归零且有清仓时间） */
  is_closed: boolean;
  /** 当前仍持有数量（部分减仓时 > 0） */
  remaining_quantity: number;
  /** 卖出笔数 */
  sell_count: number;
  /** 累计卖出数量 */
  total_sold_qty: number;
  /** 累计已实现盈亏（原币） */
  total_realized: number;
  /** 累计已实现盈亏（折算结算币种，缺汇率时为 null） */
  total_realized_settled: number | null;
  /** 累计卖出费用（原币） */
  total_fee: number;
  first_sell_at: string;
  last_sell_at: string;
  /** 原币 -> 结算币种汇率，缺失为 null */
  fx_rate: number | null;
  lots: RealizedLot[];
}

export interface RealizedSummary {
  settlement_currency: Currency;
  /** 累计已实现盈亏（折算结算币种） */
  total_realized_settled: number;
  /** 已清仓资产数 */
  closed_count: number;
  /** 仍持有但有过减仓的资产数 */
  reduced_count: number;
  fx_available: boolean;
  warnings: string[];
}

export interface RealizedResponse {
  summary: RealizedSummary;
  assets: RealizedAssetSummary[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 汇总各资产的已实现盈亏（平仓/减仓历史），按需从交易流水推算并折算到结算币种。 */
export async function computeRealized(settlement: Currency): Promise<RealizedResponse> {
  const [assets, positions] = await Promise.all([assetsRepo.list(), positionsRepo.list()]);
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const positionByAsset = new Map(positions.map((p) => [p.asset_id, p]));
  const txByAsset = await transactionsRepo.listByAssetIds(assets.map((a) => a.id));

  const result: RealizedAssetSummary[] = [];
  const warnings: string[] = [];
  let totalRealizedSettled = 0;
  let fxAvailable = true;
  let closedCount = 0;
  let reducedCount = 0;

  for (const [assetId, txs] of txByAsset) {
    const asset = assetById.get(assetId);
    if (!asset) continue;
    const lots = walkRealized(txs);
    if (lots.length === 0) continue;

    const position = positionByAsset.get(assetId) ?? null;
    const remaining = position?.quantity ?? 0;
    const isClosed = remaining <= EPS && position?.closed_at != null;

    const totalRealized = lots.reduce((sum, l) => sum + l.realized_pnl, 0);
    const totalSoldQty = lots.reduce((sum, l) => sum + l.quantity, 0);
    const totalFee = lots.reduce((sum, l) => sum + l.fee, 0);

    const rateInfo = fxService.getRate(asset.currency, settlement);
    const fxRate = rateInfo.available ? rateInfo.rate : null;
    const realizedSettled = fxRate != null ? round2(totalRealized * fxRate) : null;

    if (fxRate == null && asset.currency !== settlement) {
      fxAvailable = false;
      warnings.push(`${asset.symbol} 缺少 ${asset.currency}->${settlement} 汇率，未计入已实现盈亏汇总`);
    } else if (realizedSettled != null) {
      totalRealizedSettled += realizedSettled;
    }

    if (isClosed) closedCount += 1;
    else reducedCount += 1;

    result.push({
      asset,
      currency: asset.currency,
      is_closed: isClosed,
      remaining_quantity: remaining,
      sell_count: lots.length,
      total_sold_qty: totalSoldQty,
      total_realized: round2(totalRealized),
      total_realized_settled: realizedSettled,
      total_fee: round2(totalFee),
      first_sell_at: lots[0].trade_time,
      last_sell_at: lots[lots.length - 1].trade_time,
      fx_rate: fxRate,
      lots,
    });
  }

  // 最近卖出在前
  result.sort((a, b) => (a.last_sell_at < b.last_sell_at ? 1 : a.last_sell_at > b.last_sell_at ? -1 : 0));

  return {
    summary: {
      settlement_currency: settlement,
      total_realized_settled: round2(totalRealizedSettled),
      closed_count: closedCount,
      reduced_count: reducedCount,
      fx_available: fxAvailable,
      warnings,
    },
    assets: result,
  };
}
