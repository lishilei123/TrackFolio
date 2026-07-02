import type { Asset, Currency, Position, QuoteSnapshot, QuoteStatus } from "../domain/types.js";
import { isBeforeRegularOpen } from "../domain/marketHours.js";
import { isTradingDay } from "../domain/tradingCalendar.js";
import {
  addDays,
  dateInTimeZone,
  DEFAULT_SETTLEMENT_TIMEZONE,
  isWeekend,
  marketDateForSettlementDate,
  settlementDateForMarketClose,
} from "../domain/timezone.js";
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

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(EPS, Math.abs(b) * 1e-8);
}

function nearlySamePrice(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.01;
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
let currentSettlementTimezoneForTest: string | null = null;

export function __setCurrentSettlementDateForTest(date: string | null): void {
  currentSettlementDateForTest = date;
}

export function __setCurrentSettlementTimezoneForTest(timeZone: string | null): void {
  currentSettlementTimezoneForTest = timeZone;
}

function currentSettlementTimezone(): string {
  if (currentSettlementTimezoneForTest) return currentSettlementTimezoneForTest;
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

function isWeekdayExchangeHolidaySettlementDate(
  asset: Pick<Asset, "market" | "asset_type" | "fund_type">,
  date: string,
): boolean {
  if (isNavBased(asset)) return false;
  const timeZone = currentSettlementTimezone();
  const candidates = [addDays(date, -1), date, addDays(date, 1)];
  return candidates.some(
    (candidate) =>
      !isWeekend(candidate) &&
      settlementDateForMarketClose(asset.market, candidate, timeZone) === date &&
      !isTradingDay(asset.market, candidate),
  );
}

/** 昨日盈亏沿用自然昨日；若自然昨日是交易所工作日假期，则顺延到上一有效结算快照。 */
export function previousSettlementDateForAsset(
  asset: Pick<Asset, "market" | "asset_type" | "fund_type">,
  date = currentSettlementDate(),
): string {
  const calendarPrevious = addDays(date, -1);
  if (!isWeekdayExchangeHolidaySettlementDate(asset, calendarPrevious)) return calendarPrevious;

  let candidate = addDays(calendarPrevious, -1);
  for (let i = 0; i < 31; i++) {
    if (isValidSettlementDateForAsset(asset, candidate)) return candidate;
    candidate = addDays(candidate, -1);
  }
  return calendarPrevious;
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

function isIntradayMarketStatus(status: QuoteSnapshot["market_status"] | null | undefined): boolean {
  return status === "pre" || status === "open" || status === "post";
}

function preOpenQuoteDoesNotCoverSettlementDate(
  asset: Pick<Asset, "market" | "asset_type" | "fund_type">,
  quote: QuoteSnapshot | null,
  settlementDate: string,
): boolean {
  if (isNavBased(asset) || !isBeforeRegularOpen(asset.market, quote)) return false;
  if (asset.market === "US") return false;
  if (quote?.market_status === "closed") return true;
  return quoteSettlementDate(asset, quote) !== settlementDate;
}

interface DailyPnlMetricContext {
  previousClose: number | null;
  transactions: PnlTransaction[];
  activityDate: string;
}

function snapshotActivityDateForAsset(
  asset: Pick<Asset, "market" | "asset_type" | "fund_type">,
  row: DailyPnlRow,
): string {
  if (isNavBased(asset)) return row.date;
  return marketDateForSettlementDate(asset.market, row.date, currentSettlementTimezone()) ?? row.date;
}

function previousCloseForDailyPnlSnapshot(
  asset: Pick<Asset, "asset_type" | "fund_type">,
  row: DailyPnlRow,
  quote: QuoteSnapshot | null,
): number | null {
  if (isNavBased(asset)) return quote?.previous_nav ?? null;
  const close = row.close_price ?? row.nav;
  if (close != null && quote?.previous_close != null && quote.pre_previous_close != null && nearlyEqual(close, quote.previous_close)) {
    return quote.pre_previous_close;
  }
  return quote?.previous_close ?? null;
}

function dailyPnlMetricContext(
  asset: Pick<Asset, "market" | "asset_type" | "fund_type">,
  row: DailyPnlRow,
  quote: QuoteSnapshot | null,
  transactions: PnlTransaction[],
): DailyPnlMetricContext {
  return {
    previousClose: previousCloseForDailyPnlSnapshot(asset, row, quote),
    transactions,
    activityDate: snapshotActivityDateForAsset(asset, row),
  };
}

function metricFromDailyPnl(row: DailyPnlRow, context?: DailyPnlMetricContext): MetricValue {
  const close = row.close_price ?? row.nav;
  const amount = row.daily_pnl_amount;
  let basis = amount != null && close != null ? close * row.quantity - amount : null;
  if (amount != null && close != null && context?.previousClose != null) {
    const transactionAware = computeTransactionAwareDailyPnl(
      close,
      context.previousClose,
      row.quantity,
      context.transactions,
      context.activityDate,
      row.is_estimated === 1,
    );
    if (
      transactionAware.computable &&
      transactionAware.amount != null &&
      transactionAware.basis != null &&
      nearlyEqual(transactionAware.amount, amount)
    ) {
      basis = transactionAware.basis;
    }
  }
  return {
    amount,
    percent: amount != null && basis != null && basis !== 0 ? (amount / basis) * 100 : null,
    basis,
    computable: amount != null,
    estimated: row.is_estimated === 1,
  };
}

function dailyPnlCloseMatchesPreviousClose(row: DailyPnlRow, previousClose: number | null): boolean {
  const close = row.close_price ?? row.nav;
  return close != null && previousClose != null && nearlySamePrice(close, previousClose);
}

function dailyPnlEndValue(row: DailyPnlRow): number | null {
  const close = row.close_price ?? row.nav;
  return close != null ? close * row.quantity : null;
}

function combineSequentialMetricValues(a: MetricValue, b: MetricValue, duplicateBasis: number | null): MetricValue {
  const amount = a.amount != null && b.amount != null ? a.amount + b.amount : null;
  const incrementalBasis =
    b.basis != null && duplicateBasis != null ? Math.max(0, b.basis - duplicateBasis) : b.basis;
  const basis = a.basis != null && incrementalBasis != null ? a.basis + incrementalBasis : null;
  return {
    amount,
    percent: amount != null && basis != null && basis !== 0 ? (amount / basis) * 100 : null,
    basis,
    computable: amount != null,
    estimated: a.estimated || b.estimated,
  };
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
  const settlementDate = currentSettlementDate();
  const yesterdayDate = previousSettlementDateForAsset(asset, settlementDate);
  const todayDailyPnl = dailyPnl?.date === settlementDate ? dailyPnl : null;
  const yesterdayDailyPnl = previousDailyPnl ?? (dailyPnl?.date === yesterdayDate ? dailyPnl : null);
  const navBased = isNavBased(asset);
  const qty = position.quantity;

  const latest = navBased ? quote?.latest_nav ?? null : quote?.latest_price ?? null;
  const prevClose = navBased ? quote?.previous_nav ?? null : quote?.previous_close ?? null;
  const prePrevClose = navBased ? null : quote?.pre_previous_close ?? null;

  // 今日盈亏：盘后优先用今日结算快照（能体现当日加减仓）；盘中按实时行情计算；
  // 休市日（行情仍停在上一交易日收盘）记 0，避免把上一交易日涨跌错算成今日。
  // 注意：美股交易日可能跨用户配置的结算自然日。盘前/盘中实时值只按当前最新价相对当前收盘基准计算，
  // 不再把同一结算日早些时候的收盘快照叠加进今日盈亏。
  const quoteDay = quoteSettlementDate(asset, quote);
  const quoteBeforeRegularOpen =
    !navBased && preOpenQuoteDoesNotCoverSettlementDate(asset, quote, settlementDate);
  const hasIntradayQuoteForSettlementDate = quoteDay === settlementDate && isIntradayMarketStatus(quote?.market_status);
  const preferNonUsIntradayRealtimeToday = asset.market !== "US" && !navBased && hasIntradayQuoteForSettlementDate;
  const todayActivityDate = activityDateForAsset(asset, settlementDate, quote);
  const hasTodayTransactions = transactions.some((tx) => txDate(tx) === todayActivityDate);
  const todaySnapshot = todayDailyPnl?.daily_pnl_amount != null
    ? metricFromDailyPnl(todayDailyPnl, dailyPnlMetricContext(asset, todayDailyPnl, quote, transactions))
    : null;
  const liveToday = computeTransactionAwareDailyPnl(
    latest,
    prevClose,
    qty,
    transactions,
    todayActivityDate,
    navBased && quote?.status === "estimated",
  );
  // 美股本场落在当前结算日时，优先用实时行情。这样 17 日盘前是最新价 - 16 日收盘价；
  // 到 18 日且拿到 17 日收盘价后，行情层会把 previous_close 切到 17 日收盘价。
  const preferRealtimeToday = asset.market === "US" && !navBased && quoteDay === settlementDate;
  const combineUsSettlementSnapshotWithLive =
    preferRealtimeToday &&
    quote?.market_status !== "closed" &&
    todaySnapshot?.computable === true &&
    liveToday.computable &&
    todayActivityDate === settlementDate &&
    dailyPnlCloseMatchesPreviousClose(todayDailyPnl!, prevClose);
  let today: MetricValue;
  if (!isValidSettlementDateForAsset(asset, settlementDate) && !hasIntradayQuoteForSettlementDate) {
    today = { amount: 0, percent: 0, basis: 0, computable: true, estimated: false };
  } else if (quoteBeforeRegularOpen) {
    today = { amount: 0, percent: 0, basis: 0, computable: true, estimated: false };
  } else if (preferNonUsIntradayRealtimeToday && liveToday.computable) {
    today = liveToday;
  } else if (combineUsSettlementSnapshotWithLive) {
    today = combineSequentialMetricValues(todaySnapshot!, liveToday, dailyPnlEndValue(todayDailyPnl!));
  } else if (
    !hasTodayTransactions &&
    !preferRealtimeToday &&
    quote?.market_status !== "open" &&
    todaySnapshot?.computable === true
  ) {
    today = todaySnapshot;
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
  // 交易所工作日假期顺延到上一有效结算日；美股历史快照已统一到配置结算日（与看板同口径）。
  let yesterday: MetricValue;
  if (!isValidSettlementDateForAsset(asset, yesterdayDate)) {
    yesterday = { amount: 0, percent: 0, basis: 0, computable: true, estimated: false };
  } else if (yesterdayDailyPnl?.date === yesterdayDate && yesterdayDailyPnl.daily_pnl_amount != null) {
    yesterday = metricFromDailyPnl(
      yesterdayDailyPnl,
      dailyPnlMetricContext(asset, yesterdayDailyPnl, quote, transactions),
    );
  } else if (quoteDoesNotCoverSettlementDate(asset, quote, yesterdayDate)) {
    yesterday = { amount: 0, percent: 0, basis: 0, computable: true, estimated: false };
  } else if (
    position.closed_at?.slice(0, 10) === yesterdayDate &&
    !navBased &&
    prevClose != null &&
    prePrevClose != null
  ) {
    // 昨日清仓且无昨日快照：按交易流水确认昨日日内已实现盈亏（与「今日清仓」同口径）。
    // 隔夜持有份额以「前一交易日收盘」(prePrevClose) 为基准，昨日卖出按成交价确认。
    // qty=0 且全部平仓发生在昨日、之后无交易，故当前数量可正确反推昨日开盘持仓。
    const yesterdayActivity =
      marketDateForSettlementDate(asset.market, yesterdayDate, currentSettlementTimezone()) ?? yesterdayDate;
    const live = computeTransactionAwareDailyPnl(
      prevClose, // latest 占位：残余 qty=0，不影响结果
      prePrevClose,
      qty,
      transactions,
      yesterdayActivity,
    );
    yesterday = live.computable
      ? live
      : { amount: 0, percent: 0, basis: 0, computable: true, estimated: false };
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

/**
 * 汇总总览指标，全部折算到结算币种（需求 5.1 / 5.6）。
 * archivedHoldings：当天清仓（数量已归零）的资产，其当天已实现盈亏计入「今日盈亏」、
 * 昨日仍持有部分计入「昨日盈亏」，与历史走势图口径保持一致；不计入市值 / 成本 / 总持仓盈亏。
 */
export function computeOverview(
  holdings: Holding[],
  settlement: Currency,
  archivedHoldings: Holding[] = [],
): Overview {
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
      if (h.today_pnl.basis != null && h.today_pnl.basis !== 0) {
        todayBase += h.today_pnl.basis * rate;
      } else if (h.today_pnl.amount !== 0) {
        if (h.today_pnl.percent != null && h.today_pnl.percent !== 0 && h.today_pnl.amount != null) {
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

  // 当天清仓的资产：已无持仓，故不计入市值 / 成本 / 总持仓盈亏；
  // 但其当天兑现的已实现盈亏计入「今日盈亏」，昨日仍持有部分计入「昨日盈亏」（需求 5.7.1 / 5.7.2），
  // 与历史走势图口径一致。
  for (const h of archivedHoldings) {
    if (h.fx_rate == null && h.currency !== settlement) {
      if (h.today_pnl.computable || h.yesterday_pnl.computable) {
        warnings.push(`${h.asset.symbol} 缺少 ${h.currency}->${settlement} 汇率，已清仓资产盈亏未计入汇总`);
      }
      continue;
    }
    const rate = h.fx_rate ?? 1;
    if (h.today_pnl.computable && h.today_pnl.amount != null) {
      todayPnl += h.today_pnl.amount * rate;
      if (h.today_pnl.basis != null && h.today_pnl.basis !== 0) {
        todayBase += h.today_pnl.basis * rate;
      }
    }
    if (h.yesterday_pnl.computable && h.yesterday_pnl.amount != null) {
      yesterdayPnl += h.yesterday_pnl.amount * rate;
      if (h.yesterday_pnl.basis != null && h.yesterday_pnl.basis !== 0) {
        yesterdayBase += h.yesterday_pnl.basis * rate;
      } else if (h.yesterday_pnl.percent != null && h.yesterday_pnl.percent !== 0) {
        yesterdayBase += (h.yesterday_pnl.amount / (h.yesterday_pnl.percent / 100)) * rate;
      }
    }
  }

  const hasHoldings = holdings.length > 0 || archivedHoldings.length > 0;
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
