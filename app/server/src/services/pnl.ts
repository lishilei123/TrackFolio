import type { Asset, Currency, Position, QuoteSnapshot, QuoteStatus } from "../domain/types.js";
import { isBeforeRegularOpen } from "../domain/marketHours.js";
import { dateInTimeZone, DEFAULT_SETTLEMENT_TIMEZONE, marketDateForSettlementDate } from "../domain/timezone.js";
import type { DailyPnlRow } from "../repositories/dailyPnl.js";
import { settingsRepo } from "../repositories/settings.js";
import type { Transaction } from "../repositories/transactions.js";
import { fxService } from "./fx.js";

/** 单项盈亏指标（原币） */
export interface MetricValue {
  amount: number | null;
  percent: number | null;
  /** 比例分母（原币），用于跨资产汇总。 */
  basis?: number | null;
  computable: boolean;
  estimated: boolean;
  reason?: string;
}

export interface Holding {
  asset: Asset;
  position: Position;
  quote: QuoteSnapshot | null;
  is_nav_based: boolean;
  latest: number | null;
  previous_close: number | null;
  currency: Currency;
  data_status: QuoteStatus;
  /** 原币市值 */
  market_value: number | null;
  /** 折算结算币市值 */
  market_value_settled: number | null;
  today_pnl: MetricValue;
  yesterday_pnl: MetricValue;
  total_pnl: MetricValue;
  today_pnl_settled: number | null;
  total_pnl_settled: number | null;
  fx_rate: number | null;
}

export interface Overview {
  settlement_currency: Currency;
  total_market_value: number | null;
  total_cost: number | null;
  today_pnl: number | null;
  today_pnl_percent: number | null;
  yesterday_pnl: number | null;
  yesterday_pnl_percent: number | null;
  total_pnl: number | null;
  total_pnl_percent: number | null;
  fx_available: boolean;
  warnings: string[];
  as_of: string | null;
  holdings_count: number;
}

/** 该资产是否按净值计算（场外基金） */
export function isNavBased(asset: Pick<Asset, "asset_type" | "fund_type">): boolean {
  return asset.asset_type === "FUND" && asset.fund_type === "otc";
}

function notComputable(reason: string): MetricValue {
  return { amount: null, percent: null, computable: false, estimated: false, reason };
}

export type PnlTransaction = Pick<Transaction, "side" | "quantity" | "price" | "trade_time">;

const EPS = 1e-9;

function txDate(tx: PnlTransaction): string {
  return tx.trade_time.slice(0, 10);
}

function nearlyZero(value: number): boolean {
  return Math.abs(value) <= EPS;
}

function activityDateForAsset(
  asset: Pick<Asset, "market" | "asset_type" | "fund_type">,
  settlementDate: string,
  quote: QuoteSnapshot | null,
): string {
  if (isNavBased(asset)) return settlementDate;
  const quoteDate = datePart(quote?.quote_time);
  if (quoteDate) return quoteDate;
  return marketDateForSettlementDate(asset.market, settlementDate, currentSettlementTimezone()) ?? settlementDate;
}

/**
 * 今日盈亏按交易流水拆分基准：
 * - 昨日已持有份额按上一收盘/上一净值作为今日基准；
 * - 今日买入份额按成交价作为基准；
 * - 今日卖出份额按卖出价确认日内已实现价格变动。
 *
 * 费用仍只进入总持仓盈亏，保持现有 daily_pnl 的价格/净值变动口径。
 */
export function computeTransactionAwareDailyPnl(
  latest: number | null,
  previousClose: number | null,
  currentQuantity: number,
  transactions: PnlTransaction[] = [],
  activityDate: string,
  estimated = false,
): MetricValue {
  if (latest == null) return notComputable("缺少最新价或净值");

  const dayTxs = transactions
    .filter((tx) => txDate(tx) === activityDate)
    .sort((a, b) => a.trade_time.localeCompare(b.trade_time));
  const netToday = dayTxs.reduce((sum, tx) => sum + (tx.side === "BUY" ? tx.quantity : -tx.quantity), 0);
  const startQuantity = currentQuantity - netToday;
  if (startQuantity < -EPS) return notComputable("今日交易流水与当前持仓数量不匹配");

  let quantity = nearlyZero(startQuantity) ? 0 : startQuantity;
  let basisValue = 0;
  let denominator = 0;
  let realized = 0;

  if (quantity > EPS) {
    if (previousClose == null) return notComputable("缺少上一收盘价或上一净值");
    basisValue = previousClose * quantity;
    denominator += basisValue;
  }

  for (const tx of dayTxs) {
    if (tx.side === "BUY") {
      quantity += tx.quantity;
      const buyBasis = tx.price * tx.quantity;
      basisValue += buyBasis;
      denominator += buyBasis;
      continue;
    }

    if (tx.quantity > quantity + EPS || quantity <= EPS) {
      return notComputable("今日卖出数量超过可用持仓");
    }
    const unitBasis = basisValue / quantity;
    realized += (tx.price - unitBasis) * tx.quantity;
    basisValue -= unitBasis * tx.quantity;
    quantity -= tx.quantity;
    if (nearlyZero(quantity)) {
      quantity = 0;
      basisValue = 0;
    }
  }

  const effectiveQuantity = nearlyZero(quantity) ? 0 : quantity;
  const amount = realized + (latest * effectiveQuantity - basisValue);
  return {
    amount,
    percent: denominator !== 0 ? (amount / denominator) * 100 : nearlyZero(amount) ? 0 : null,
    basis: denominator,
    computable: true,
    estimated,
  };
}

let currentSettlementDateForTest: string | null = null;

export function __setCurrentSettlementDateForTest(date: string | null): void {
  currentSettlementDateForTest = date;
}

function currentSettlementTimezone(): string {
  try {
    return settingsRepo.getDisplay().settlement_timezone || DEFAULT_SETTLEMENT_TIMEZONE;
  } catch {
    return DEFAULT_SETTLEMENT_TIMEZONE;
  }
}

export function currentSettlementDate(): string {
  if (currentSettlementDateForTest) return currentSettlementDateForTest;
  return dateInTimeZone(new Date(), currentSettlementTimezone()) ?? new Date().toISOString().slice(0, 10);
}

function previousSettlementDate(): string {
  const d = new Date(Date.parse(`${currentSettlementDate()}T00:00:00.000Z`) - 86_400_000);
  return d.toISOString().slice(0, 10);
}

function isWeekendSettlementDate(date: string): boolean {
  const day = new Date(Date.parse(`${date}T00:00:00.000Z`)).getUTCDay();
  return day === 0 || day === 6;
}

function isValidSettlementDateForAsset(
  asset: Pick<Asset, "market" | "asset_type" | "fund_type">,
  date: string,
): boolean {
  if (isNavBased(asset)) return !isWeekendSettlementDate(date);
  return marketDateForSettlementDate(asset.market, date, currentSettlementTimezone()) != null;
}

function datePart(value: string | null | undefined): string | null {
  return value?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
}

function quoteSettlementDate(asset: Pick<Asset, "asset_type" | "fund_type">, quote: QuoteSnapshot | null): string | null {
  if (!quote) return null;
  const timeZone = currentSettlementTimezone();
  if (isNavBased(asset)) return datePart(quote.nav_date) ?? (quote.quote_time ? dateInTimeZone(quote.quote_time, timeZone) : null);
  return quote.quote_time ? dateInTimeZone(quote.quote_time, timeZone) : null;
}

function quoteDoesNotCoverSettlementDate(
  asset: Pick<Asset, "asset_type" | "fund_type">,
  quote: QuoteSnapshot | null,
  settlementDate: string,
): boolean {
  if (isNavBased(asset)) return false;
  const quoteDay = quoteSettlementDate(asset, quote);
  return quoteDay != null && quoteDay < settlementDate;
}

/** 计算单个持仓的盈亏，并折算到结算币种 */
export function computeHolding(
  asset: Asset,
  position: Position,
  quote: QuoteSnapshot | null,
  settlement: Currency,
  dailyPnl: DailyPnlRow | null = null,
  previousDailyPnl: DailyPnlRow | null = null,
  transactions: PnlTransaction[] = [],
): Holding {
  const todayDailyPnl = dailyPnl?.date === currentSettlementDate() ? dailyPnl : null;
  const yesterdayDailyPnl = previousDailyPnl ?? (dailyPnl?.date === previousSettlementDate() ? dailyPnl : null);
  const navBased = isNavBased(asset);
  const qty = position.quantity;

  const latest = navBased ? quote?.latest_nav ?? null : quote?.latest_price ?? null;
  const prevClose = navBased ? quote?.previous_nav ?? null : quote?.previous_close ?? null;
  const prePrevClose = navBased ? null : quote?.pre_previous_close ?? null;

  // 今日盈亏：盘后优先用今日结算快照（能体现当日加减仓）；盘中按实时行情计算；
  // 休市日（行情仍停在上一交易日收盘）记 0，避免把上一交易日涨跌错算成今日。
  // 注意：美股交易日可能跨用户配置的结算自然日——上一场收盘会落到「当前结算日」的结算快照，而当天晚间
  // 美股新一场又会开盘。此时若仍用旧快照，会把盘中实时涨跌错显示成上一场收盘结果，故盘中（open）
  // 一律改用实时行情，仅在非交易时段才采用今日结算快照。
  const quoteDay = quoteSettlementDate(asset, quote);
  const settlementDate = currentSettlementDate();
  const quoteBeforeRegularOpen = !navBased && isBeforeRegularOpen(asset.market, quote);
  const todayActivityDate = activityDateForAsset(asset, settlementDate, quote);
  const hasTodayTransactions = transactions.some((tx) => txDate(tx) === todayActivityDate);
  const liveToday = computeTransactionAwareDailyPnl(
    latest,
    prevClose,
    qty,
    transactions,
    todayActivityDate,
    navBased && quote?.status === "estimated",
  );
  // 美股本场落在当前结算日时，优先用实时行情（兜底）：
  //   · 盘后到 snapshotToday 生成前的空窗，今日快照尚不存在；
  //   · 当晚新一场开盘后，避免误用上一场落到当前结算日的旧快照；
  //   · 未点「校验」的旧库里若残留被净成 0 的今日快照，也借此绕过。
  // 统一结算日后，正常情况下今日快照已对齐，此实时值与快照同值。
  const preferRealtimeToday = asset.market === "US" && !navBased && quoteDay === settlementDate;
  let today: MetricValue;
  if (!isValidSettlementDateForAsset(asset, settlementDate)) {
    today = { amount: 0, percent: 0, basis: 0, computable: true, estimated: false };
  } else if (quoteBeforeRegularOpen) {
    today = { amount: 0, percent: 0, basis: 0, computable: true, estimated: false };
  } else if (
    !hasTodayTransactions &&
    !preferRealtimeToday &&
    quote?.market_status !== "open" &&
    todayDailyPnl?.daily_pnl_amount != null
  ) {
    const close = todayDailyPnl.close_price ?? todayDailyPnl.nav;
    const basis = close != null ? close * todayDailyPnl.quantity - todayDailyPnl.daily_pnl_amount : null;
    today = {
      amount: todayDailyPnl.daily_pnl_amount,
      percent: basis != null && basis !== 0 ? (todayDailyPnl.daily_pnl_amount / basis) * 100 : null,
      basis,
      computable: true,
      estimated: todayDailyPnl.is_estimated === 1,
    };
  } else if (quote?.market_status === "closed") {
    // 已收盘且今日结算快照尚未生成：
    //   · 若最新行情就是「当前结算日」收盘（盘后到快照生成前的空窗，
    //     正好落在当前结算日），仍按 (收盘价 - 上一收盘) * 数量 实时给出今日盈亏，避免这段时间归零；
    //   · 否则行情停在更早交易日（休市日/周末/盘前隔夜），记 0，避免把过往涨跌错算成今日。
    if (quoteDay === settlementDate) {
      today = liveToday;
    } else {
      today = { amount: 0, percent: 0, basis: 0, computable: true, estimated: false };
    }
  } else if (liveToday.computable) {
    today = liveToday;
  } else {
    today = liveToday.reason ? liveToday : notComputable("缺少最新价/上一收盘价或净值");
  }

  // 昨日盈亏（需求 5.5.2）优先使用 DailyPnL 快照，避免昨日新增/加仓时用当前数量倒推导致错误。
  // 美股历史快照已统一到配置结算日（与看板同口径），故昨日直接读对齐后的快照，无需再为交易日错位特判。
  let yesterday: MetricValue;
  const yesterdayDate = previousSettlementDate();
  if (!isValidSettlementDateForAsset(asset, yesterdayDate)) {
    yesterday = { amount: 0, percent: 0, basis: 0, computable: true, estimated: false };
  } else if (quoteDoesNotCoverSettlementDate(asset, quote, yesterdayDate)) {
    yesterday = { amount: 0, percent: 0, basis: 0, computable: true, estimated: false };
  } else if (yesterdayDailyPnl?.date === yesterdayDate && yesterdayDailyPnl.daily_pnl_amount != null) {
    const close = yesterdayDailyPnl.close_price ?? yesterdayDailyPnl.nav;
    const basis = close != null ? close * yesterdayDailyPnl.quantity - yesterdayDailyPnl.daily_pnl_amount : null;
    yesterday = {
      amount: yesterdayDailyPnl.daily_pnl_amount,
      percent: basis != null && basis !== 0 ? (yesterdayDailyPnl.daily_pnl_amount / basis) * 100 : null,
      basis,
      computable: true,
      estimated: yesterdayDailyPnl.is_estimated === 1,
    };
  } else if (position.opened_at?.slice(0, 10) === yesterdayDate && prevClose != null) {
    // 昨日新建仓但缺少 DailyPnL 快照时，不能用前一日收盘倒推；按昨日收盘相对买入均价计算。
    const amount = (prevClose - position.avg_cost) * qty - position.total_fee;
    const denom = position.avg_cost * qty + position.total_fee;
    yesterday = {
      amount,
      percent: denom !== 0 ? (amount / denom) * 100 : null,
      basis: denom,
      computable: true,
      estimated: true,
    };
  } else if (navBased) {
    yesterday = notComputable("场外基金缺少前一净值历史，暂不计算");
  } else if (prevClose == null || prePrevClose == null) {
    yesterday = notComputable("缺少昨日/前一交易日收盘价");
  } else {
    const amount = (prevClose - prePrevClose) * qty;
    const denom = prePrevClose * qty;
    yesterday = {
      amount,
      percent: denom !== 0 ? (amount / denom) * 100 : null,
      basis: denom,
      computable: true,
      estimated: true, // 无历史快照时才用当前持仓数量近似
    };
  }

  // 总持仓盈亏（需求 5.5.3）
  let total: MetricValue;
  if (latest == null) {
    total = notComputable("缺少最新价或净值");
  } else {
    const amount = (latest - position.avg_cost) * qty - position.total_fee;
    const denom = position.avg_cost * qty + position.total_fee;
    total = {
      amount,
      percent: denom !== 0 ? (amount / denom) * 100 : null,
      basis: denom,
      computable: true,
      estimated: false,
    };
  }

  const marketValue = latest != null ? latest * qty : null;

  const rateInfo = fxService.getRate(asset.currency, settlement);
  const fxRate = rateInfo.available ? rateInfo.rate : null;
  const settle = (v: number | null): number | null =>
    v != null && fxRate != null ? v * fxRate : null;

  return {
    asset,
    position,
    quote,
    is_nav_based: navBased,
    latest,
    previous_close: prevClose,
    currency: asset.currency,
    data_status: quote?.status ?? "unavailable",
    market_value: marketValue,
    market_value_settled: settle(marketValue),
    today_pnl: today,
    yesterday_pnl: yesterday,
    total_pnl: total,
    today_pnl_settled: settle(today.amount),
    total_pnl_settled: settle(total.amount),
    fx_rate: fxRate,
  };
}

/** 汇总总览指标，全部折算到结算币种（需求 5.1 / 5.6） */
export function computeOverview(holdings: Holding[], settlement: Currency): Overview {
  const warnings: string[] = [];
  let totalMv = 0;
  let totalCost = 0;
  let todayPnl = 0;
  let yesterdayPnl = 0;
  let totalPnl = 0;
  let todayBase = 0; // 今日盈亏比例分母（折算后的上一收盘市值）
  let yesterdayBase = 0; // 昨日盈亏比例分母（折算后的前一交易日收盘市值）
  let fxAvailable = true;
  let asOf: string | null = null;

  for (const h of holdings) {
    if (h.fx_rate == null && h.currency !== settlement) {
      fxAvailable = false;
      warnings.push(`${h.asset.symbol} 缺少 ${h.currency}->${settlement} 汇率，未计入汇总`);
      continue;
    }
    const rate = h.fx_rate ?? 1;

    if (h.market_value_settled != null) totalMv += h.market_value_settled;
    totalCost += (h.position.avg_cost * h.position.quantity + h.position.total_fee) * rate;

    if (h.today_pnl.computable && h.today_pnl_settled != null) {
      todayPnl += h.today_pnl_settled;
      if (h.today_pnl.amount !== 0) {
        if (h.today_pnl.basis != null && h.today_pnl.basis !== 0) {
          todayBase += h.today_pnl.basis * rate;
        } else if (h.today_pnl.percent != null && h.today_pnl.percent !== 0 && h.today_pnl.amount != null) {
          todayBase += (h.today_pnl.amount / (h.today_pnl.percent / 100)) * rate;
        } else if (h.previous_close != null) {
          todayBase += h.previous_close * h.position.quantity * rate;
        }
      }
    }
    if (h.yesterday_pnl.computable && h.yesterday_pnl.amount != null) {
      yesterdayPnl += h.yesterday_pnl.amount * rate;
      if (h.yesterday_pnl.percent != null && h.yesterday_pnl.percent !== 0) {
        yesterdayBase += (h.yesterday_pnl.amount / (h.yesterday_pnl.percent / 100)) * rate;
      } else if (h.quote?.pre_previous_close != null) {
        // 无快照比例时退回前一交易日收盘市值估算
        yesterdayBase += h.quote.pre_previous_close * h.position.quantity * rate;
      }
    }
    if (h.total_pnl.computable && h.total_pnl_settled != null) {
      totalPnl += h.total_pnl_settled;
    }

    const t = h.quote?.quote_time ?? h.quote?.nav_date ?? null;
    if (t && (!asOf || t > asOf)) asOf = t;
  }

  const hasHoldings = holdings.length > 0;
  return {
    settlement_currency: settlement,
    total_market_value: hasHoldings ? round2(totalMv) : 0,
    total_cost: hasHoldings ? round2(totalCost) : 0,
    today_pnl: hasHoldings ? round2(todayPnl) : 0,
    today_pnl_percent: todayBase !== 0 ? round2((todayPnl / todayBase) * 100) : null,
    yesterday_pnl: hasHoldings ? round2(yesterdayPnl) : 0,
    yesterday_pnl_percent: yesterdayBase !== 0 ? round2((yesterdayPnl / yesterdayBase) * 100) : null,
    total_pnl: hasHoldings ? round2(totalPnl) : 0,
    total_pnl_percent: totalCost !== 0 ? round2((totalPnl / totalCost) * 100) : null,
    fx_available: fxAvailable,
    warnings,
    as_of: asOf,
    holdings_count: holdings.length,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
