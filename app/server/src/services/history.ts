import type { Asset, Currency, QuoteSnapshot } from "../domain/types.js";
import { isBeforeRegularOpen } from "../domain/marketHours.js";
import {
  addDays,
  dateInTimeZone,
  DEFAULT_SETTLEMENT_TIMEZONE,
  isWeekend,
  marketDateForSettlementDate,
  settlementDateForMarketClose,
} from "../domain/timezone.js";
import { getProvider } from "../providers/index.js";
import { assetsRepo } from "../repositories/assets.js";
import { dailyPnlRepo } from "../repositories/dailyPnl.js";
import type { DailyPnlRow, NewDailyPnl } from "../repositories/dailyPnl.js";
import { positionsRepo } from "../repositories/positions.js";
import { quotesRepo } from "../repositories/quotes.js";
import { settingsRepo } from "../repositories/settings.js";
import { transactionsRepo } from "../repositories/transactions.js";
import { fxService } from "./fx.js";
import { buildDailyCostStates, walkRealized, type CostTx } from "./position.js";
import {
  computeHolding,
  computeTransactionAwareDailyPnl,
  isNavBased,
  shouldKeepUsPremarketDailyPnlSnapshot,
} from "./pnl.js";

export type Granularity = "day" | "week" | "month" | "year";

export interface HistoryPoint {
  date: string; // 用于展示的桶日期（周粒度取桶内第一天，其余粒度取桶内最后一天）
  total_pnl: number | null; // 累计盈亏（结算币，时点值）
  daily_pnl: number | null; // 当期盈亏（结算币，桶内求和）
  top_contributor: string | null; // 当期盈亏贡献最大的资产
}

export interface HistoryContribution {
  asset_id: string;
  name: string;
  value: number; // 区间内该资产累计贡献的盈亏（结算币）
}

export interface HistoryResult {
  from: string;
  to: string;
  granularity: Granularity;
  settlement_currency: Currency;
  is_estimated: boolean;
  fx_available: boolean;
  asset_id: string | null;
  points: HistoryPoint[];
  contributions: HistoryContribution[]; // 区间内各资产的盈亏贡献（用于贡献柱状图）
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function currentSettlementTimezone(): string {
  try {
    return settingsRepo.getDisplay().settlement_timezone || DEFAULT_SETTLEMENT_TIMEZONE;
  } catch {
    return DEFAULT_SETTLEMENT_TIMEZONE;
  }
}

function todayStr(timeZone = currentSettlementTimezone()): string {
  return dateInTimeZone(new Date(), timeZone) ?? new Date().toISOString().slice(0, 10);
}

function datePart(value: string | null | undefined): string | null {
  if (!value) return null;
  const direct = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (direct) return direct;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

/**
 * 历史 K 线日期是市场本地交易日；落库日期按该市场收盘瞬间换算到用户选择的结算时区。
 * 场外基金净值按披露的净值日期入账，不做时区换算。
 */
function settlementDateForHistory(
  asset: Pick<Asset, "market" | "asset_type" | "fund_type">,
  marketDate: string,
  timeZone = currentSettlementTimezone(),
): string {
  return isNavBased(asset) ? marketDate : settlementDateForMarketClose(asset.market, marketDate, timeZone);
}

function quoteEffectiveDate(
  asset: Pick<Asset, "market" | "asset_type" | "fund_type">,
  quote: Pick<QuoteSnapshot, "nav_date" | "quote_time"> & Partial<Pick<QuoteSnapshot, "market_status">>,
  timeZone = currentSettlementTimezone(),
): string | null {
  if (isNavBased(asset)) return datePart(quote.nav_date) ?? dateInTimeZone(quote.quote_time ?? "", timeZone);
  if (quote.market_status !== "closed") return null;
  return quote.quote_time ? dateInTimeZone(quote.quote_time, timeZone) : null;
}

function isIntradayMarketStatus(status: QuoteSnapshot["market_status"] | null | undefined): boolean {
  return status === "pre" || status === "open" || status === "post";
}

function preOpenQuoteDoesNotCoverSettlementDate(
  snapshotDate: string,
  asset: Pick<Asset, "market" | "asset_type" | "fund_type">,
  quote: Pick<QuoteSnapshot, "quote_time"> & Partial<Pick<QuoteSnapshot, "market_status">>,
  timeZone: string,
): boolean {
  if (isNavBased(asset) || !isBeforeRegularOpen(asset.market, quote)) return false;
  if (asset.market === "US") return false;
  if (quote.market_status === "closed") return true;
  return quote.quote_time ? dateInTimeZone(quote.quote_time, timeZone) !== snapshotDate : true;
}

export function hasLiveQuoteForSettlementDate(
  asset: Pick<Asset, "market" | "asset_type" | "fund_type">,
  date: string,
  quote: Pick<QuoteSnapshot, "quote_time"> & Partial<Pick<QuoteSnapshot, "market_status">>,
  timeZone = currentSettlementTimezone(),
): boolean {
  if (isNavBased(asset) || !isIntradayMarketStatus(quote.market_status) || !quote.quote_time) return false;
  return dateInTimeZone(quote.quote_time, timeZone) === date;
}

export function snapshotDateForQuote(
  asset: Pick<Asset, "market" | "asset_type" | "fund_type">,
  quote: Pick<QuoteSnapshot, "nav_date" | "quote_time"> & Partial<Pick<QuoteSnapshot, "market_status">>,
  fallbackDate = todayStr(),
  timeZone = currentSettlementTimezone(),
): string {
  const effectiveDate = quoteEffectiveDate(asset, quote, timeZone);
  if (!effectiveDate) return fallbackDate;
  return effectiveDate;
}

export function isCarryForwardSnapshot(
  snapshotDate: string,
  asset: Pick<Asset, "market" | "asset_type" | "fund_type">,
  quote: Pick<QuoteSnapshot, "nav_date" | "quote_time"> & Partial<Pick<QuoteSnapshot, "market_status">>,
  timeZone = currentSettlementTimezone(),
): boolean {
  if (preOpenQuoteDoesNotCoverSettlementDate(snapshotDate, asset, quote, timeZone)) {
    return true;
  }
  const effectiveDate = quoteEffectiveDate(asset, quote, timeZone);
  return effectiveDate != null && effectiveDate < snapshotDate;
}

export function isValidSettlementSnapshotDate(
  asset: Pick<Asset, "market" | "asset_type" | "fund_type">,
  date: string,
  timeZone = currentSettlementTimezone(),
): boolean {
  if (isNavBased(asset)) return !isWeekend(date);
  return marketDateForSettlementDate(asset.market, date, timeZone) != null;
}

export function filterValidHistoryPointsForAsset<T extends { date: string }>(
  asset: Pick<Asset, "market" | "asset_type" | "fund_type">,
  points: T[],
  timeZone = currentSettlementTimezone(),
): T[] {
  return points.filter((p) => isValidSettlementSnapshotDate(asset, settlementDateForHistory(asset, p.date, timeZone), timeZone));
}

export function incrementalDailyPnl(total: number | null, previousTotal: number | null | undefined): number | null {
  if (total == null) return null;
  return previousTotal != null ? total - previousTotal : total;
}

/**
 * 快照「当日盈亏」取值：
 * - 优先使用按昨收算出的当日涨跌 `quoteDaily`（= (收盘 - 昨收) × 数量）。
 * - quoteDaily 缺失时才退回累计盈亏相邻差值；不能把建仓至今的累计总盈亏当成当日涨跌。
 */
export function snapshotDailyPnl(
  quoteDaily: number | null,
  total: number | null,
  previousTotal: number | null | undefined,
): number | null {
  return quoteDaily ?? (previousTotal != null ? incrementalDailyPnl(total, previousTotal) : null);
}

export function snapshotDailyPnlForQuote(
  snapshotDate: string,
  asset: Pick<Asset, "market" | "asset_type" | "fund_type">,
  quote: Pick<QuoteSnapshot, "nav_date" | "quote_time"> & Partial<Pick<QuoteSnapshot, "market_status">>,
  quoteDaily: number | null,
  total: number | null,
  previousTotal: number | null | undefined,
  timeZone = currentSettlementTimezone(),
): number | null {
  return isCarryForwardSnapshot(snapshotDate, asset, quote, timeZone)
    ? 0
    : snapshotDailyPnl(quoteDaily, total, previousTotal);
}

function dayDiffInclusive(from: string, to: string): number {
  const start = Date.parse(from + "T00:00:00.000Z");
  const end = Date.parse(to + "T00:00:00.000Z");
  return Math.max(1, Math.floor((end - start) / 86_400_000) + 1);
}

/** 把日期归到所属桶的 key（用于分组） */
function bucketKey(date: string, g: Granularity): string {
  if (g === "day") return date;
  if (g === "month") return date.slice(0, 7); // YYYY-MM
  if (g === "year") return date.slice(0, 4); // YYYY
  // week：归到所在周的周一（YYYY-MM-DD）
  const d = new Date(date + "T00:00:00.000Z");
  const dow = (d.getUTCDay() + 6) % 7; // 周一=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/**
 * 纯函数：把原币每日快照折算到结算币并按粒度分桶聚合。
 * - daily_pnl 为流量，桶内求和；total_pnl 为时点累计值，取桶内最后一天。
 * - 缺失汇率的资产跳过并标记 fx 不可用（与 computeOverview 一致）。
 */
export function aggregateHistory(
  rows: DailyPnlRow[],
  settlement: Currency,
  granularity: Granularity,
  getRate: (from: Currency, to: Currency) => number | null,
  nameOf: (assetId: string) => string = (id) => id,
): Omit<HistoryResult, "from" | "to" | "settlement_currency" | "asset_id"> {
  let fxAvailable = true;
  let isEstimated = false;

  // 按日期汇总（跨资产）
  interface DayAgg {
    daily: number;
    total: number;
    contrib: Map<string, number>; // asset_id -> 当日盈亏（结算币）
    assetTotals: Map<string, number>; // asset_id -> 当日累计盈亏（结算币）
  }
  const byDate = new Map<string, DayAgg>();

  for (const r of rows) {
    if (r.is_estimated) isEstimated = true;
    const rate = getRate(r.currency, settlement);
    if (rate == null) {
      fxAvailable = false;
      continue;
    }
    const agg = byDate.get(r.date) ?? { daily: 0, total: 0, contrib: new Map(), assetTotals: new Map() };
    if (r.daily_pnl_amount != null) {
      const d = r.daily_pnl_amount * rate;
      agg.daily += d;
      agg.contrib.set(r.asset_id, (agg.contrib.get(r.asset_id) ?? 0) + d);
    }
    if (r.total_pnl_amount != null) {
      const t = r.total_pnl_amount * rate;
      agg.assetTotals.set(r.asset_id, t);
    }
    byDate.set(r.date, agg);
  }

  const dates = [...byDate.keys()].sort();
  const currentTotals = new Map<string, number>();
  for (const date of dates) {
    const day = byDate.get(date)!;
    for (const [aid, total] of day.assetTotals) currentTotals.set(aid, total);
    day.total = [...currentTotals.values()].reduce((sum, total) => sum + total, 0);
  }

  // 按粒度分桶（保持时间顺序）
  interface BucketAgg {
    key: string;
    firstDate: string;
    lastDate: string;
    daily: number;
    total: number;
    contrib: Map<string, number>;
  }
  const buckets = new Map<string, BucketAgg>();
  for (const date of dates) {
    const key = bucketKey(date, granularity);
    const day = byDate.get(date)!;
    const b = buckets.get(key) ?? {
      key,
      firstDate: date,
      lastDate: date,
      daily: 0,
      total: 0,
      contrib: new Map(),
    };
    if (date < b.firstDate) b.firstDate = date;
    b.daily += day.daily;
    // total 取桶内最后一天的时点值
    if (date >= b.lastDate) {
      b.lastDate = date;
      b.total = day.total;
    }
    for (const [aid, v] of day.contrib) b.contrib.set(aid, (b.contrib.get(aid) ?? 0) + v);
    buckets.set(key, b);
  }

  const orderedBuckets = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
  // 区间内各资产累计贡献：把每个桶的当期 daily 贡献逐桶累加。
  const contribByAsset = new Map<string, number>();
  const points: HistoryPoint[] = orderedBuckets.map((b) => {
    const periodPnl = b.daily;
    const bucketContrib = b.contrib;
    let top: string | null = null;
    let topAbs = 0;
    for (const [aid, v] of bucketContrib) {
      contribByAsset.set(aid, (contribByAsset.get(aid) ?? 0) + v);
      if (Math.abs(v) > topAbs) {
        topAbs = Math.abs(v);
        top = nameOf(aid);
      }
    }
    return {
      date: granularity === "week" ? b.firstDate : b.lastDate,
      total_pnl: round2(b.total),
      daily_pnl: round2(periodPnl),
      top_contributor: top,
    };
  });

  const contributions: HistoryContribution[] = [...contribByAsset.entries()].map(
    ([asset_id, value]) => ({ asset_id, name: nameOf(asset_id), value: round2(value) }),
  );

  return { granularity, is_estimated: isEstimated, fx_available: fxAvailable, points, contributions };
}

export function mergeLiveTodayRows(storedRows: DailyPnlRow[], today: string, liveRows: DailyPnlRow[]): DailyPnlRow[] {
  if (liveRows.length === 0) return storedRows;
  const liveAssetIds = new Set(liveRows.map((r) => r.asset_id));
  return [...storedRows.filter((r) => r.date !== today || !liveAssetIds.has(r.asset_id)), ...liveRows];
}

/**
 * 用当前持仓 + 最新行情合成「今日」实时快照行（原币，累计盈亏时点值）。
 * 让账户盈亏走势的最后一个点跟随实时行情，而不是停在上一交易日收盘快照。
 */
async function liveTodayRows(
  date: string,
  settlement: Currency,
  todaySnapshots: DailyPnlRow[],
  timeZone: string,
  assetId?: string | null,
): Promise<DailyPnlRow[]> {
  const assetById = new Map((await assetsRepo.list()).map((a) => [a.id, a]));
  const quoteById = new Map((await quotesRepo.all()).map((q) => [q.asset_id, q]));
  const todayByAsset = new Map(todaySnapshots.map((r) => [r.asset_id, r]));
  const rows: DailyPnlRow[] = [];
  for (const p of await positionsRepo.list()) {
    // 当天清仓（数量归零）的资产：当天已实现盈亏计入今日「当期盈亏」，落袋已实现计入累计 total。
    const closedToday = p.quantity <= 0 && p.closed_at != null && p.closed_at.slice(0, 10) === date;
    if (p.quantity <= 0 && !closedToday) continue;
    if (assetId && p.asset_id !== assetId) continue;
    const asset = assetById.get(p.asset_id);
    if (!asset) continue;
    const quote = quoteById.get(asset.id);
    if (!quote) continue;
    if (!isValidSettlementSnapshotDate(asset, date, timeZone) && !hasLiveQuoteForSettlementDate(asset, date, quote, timeZone)) continue;
    if (isCarryForwardSnapshot(date, asset, quote, timeZone)) continue;
    const navBased = isNavBased(asset);
    const latest = navBased ? quote.latest_nav : quote.latest_price;
    if (latest == null) continue;
    const txs = await transactionsRepo.listByAsset(asset.id);
    const todaySnapshot = todayByAsset.get(asset.id) ?? null;
    const prevClose = navBased ? quote.previous_nav : quote.previous_close;
    const hasTodayTransactions = txs.some((tx) => tx.trade_time.slice(0, 10) === date);
    if (shouldKeepUsPremarketDailyPnlSnapshot(asset, quote, todaySnapshot, prevClose, hasTodayTransactions)) {
      continue;
    }
    const holding = computeHolding(asset, p, quote, settlement, todaySnapshot, null, txs);
    if (closedToday && !holding.today_pnl.computable) continue;
    // 累计 total 纳入已实现毛盈亏（减仓/清仓的落袋部分）：当天清仓 qty=0 → total = 已实现 − 费用；
    // 活跃持仓有过减仓时 → 已实现 + 当前浮盈 − 费用。
    const realized = walkRealized(txs as CostTx[]).reduce((s, l) => s + (l.proceeds - l.cost_basis), 0);
    rows.push({
      date,
      asset_id: asset.id,
      market: asset.market,
      asset_type: asset.asset_type,
      quantity: p.quantity,
      close_price: navBased ? null : latest,
      nav: navBased ? latest : null,
      daily_pnl_amount: holding.today_pnl.computable ? holding.today_pnl.amount : null,
      total_pnl_amount: realized + (latest - p.avg_cost) * p.quantity - p.total_fee,
      currency: asset.currency,
      is_estimated: 1,
      created_at: "",
    });
  }
  return rows;
}

/** 读取区间历史并折算聚合 */
export async function getHistory(opts: {
  from: string;
  to: string;
  granularity: Granularity;
  settlement: Currency;
  asset_id?: string | null;
}): Promise<HistoryResult> {
  const { from, to, granularity, settlement, asset_id } = opts;
  const timeZone = currentSettlementTimezone();
  const assets = await assetsRepo.list();
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const stored = asset_id
    ? await dailyPnlRepo.listByAsset(asset_id, from, to)
    : await dailyPnlRepo.listRange(from, to);
  const validStored = stored.filter((r) => {
    const asset = assetById.get(r.asset_id);
    return asset == null || isValidSettlementSnapshotDate(asset, r.date, timeZone);
  });

  // 今日在区间内时，用实时行情覆盖今日快照行，使走势最后一个点实时。
  const today = todayStr(timeZone);
  let rows = validStored;
  if (from <= today && today <= to) {
    const live = await liveTodayRows(today, settlement, validStored.filter((r) => r.date === today), timeZone, asset_id);
    rows = mergeLiveTodayRows(validStored, today, live);
  }

  // 预加载资产名，使 aggregateHistory 的 nameOf 回调保持同步（纯函数）。
  const nameMap = new Map(assets.map((a) => [a.id, a.name || a.symbol]));
  const nameOf = (id: string): string => nameMap.get(id) ?? id;
  const getRate = (f: Currency, t: Currency): number | null => {
    const info = fxService.getRate(f, t);
    return info.available ? info.rate : null;
  };

  const agg = aggregateHistory(rows, settlement, granularity, getRate, nameOf);
  return { from, to, settlement_currency: settlement, asset_id: asset_id ?? null, ...agg };
}

/**
 * 把单个资产的一日盈亏算成快照行（原币）。
 * realized：截至该日的已实现毛盈亏（Σ 卖出 (卖出价 − 当时均价) × 数量）；累计 total 纳入已落袋部分，
 * 使已清仓/减仓持仓的累计曲线保持落袋盈亏而非陈旧浮盈（不传则为 0，行为不变）。
 */
export function toDailyPnlRow(
  date: string,
  asset: { id: string; market: DailyPnlRow["market"]; asset_type: DailyPnlRow["asset_type"]; currency: Currency },
  navBased: boolean,
  close: number,
  prevClose: number | null,
  qty: number,
  avgCost: number,
  fee: number,
  estimated: boolean,
  realized = 0,
): NewDailyPnl {
  const daily = prevClose != null ? (close - prevClose) * qty : null;
  const total = realized + (close - avgCost) * qty - fee;
  return {
    date,
    asset_id: asset.id,
    market: asset.market,
    asset_type: asset.asset_type,
    quantity: qty,
    close_price: navBased ? null : close,
    nav: navBased ? close : null,
    daily_pnl_amount: daily,
    total_pnl_amount: total,
    currency: asset.currency,
    is_estimated: estimated ? 1 : 0,
  };
}

/** 截至 date（含）的已实现毛盈亏：Σ 卖出 (卖出价 − 当时均价) × 数量 = Σ(proceeds − cost_basis) */
function grossRealizedAsOf(lots: ReturnType<typeof walkRealized>, date: string): number {
  return lots.reduce((sum, l) => (l.trade_time.slice(0, 10) <= date ? sum + (l.proceeds - l.cost_basis) : sum), 0);
}

export function buildTransactionAwareDailyPnlRows(
  asset: Asset,
  txs: Parameters<typeof buildDailyCostStates>[0],
  points: Array<{ date: string; close: number }>,
  estimated = true,
  timeZone = currentSettlementTimezone(),
): NewDailyPnl[] {
  const navBased = isNavBased(asset);
  const sortedTxs = [...txs].sort((a, b) => a.trade_time.localeCompare(b.trade_time));
  const sortedPoints = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const states = buildDailyCostStates(sortedTxs, sortedPoints.map((p) => p.date));
  // 已实现毛盈亏（落袋部分）：纳入累计 total，使清仓/减仓后曲线保持落袋盈亏而非陈旧浮盈。
  const lots = walkRealized(sortedTxs as CostTx[]);
  const rows: NewDailyPnl[] = [];
  let previousHeldClose: number | null = null;

  const firstPriceDate = sortedPoints[0]?.date ?? null;
  const anchorDates = [...new Set(sortedTxs.map((tx) => tx.trade_time.slice(0, 10)))]
    .filter((date) => firstPriceDate == null || date < firstPriceDate)
    .sort();
  for (const state of buildDailyCostStates(sortedTxs, anchorDates)) {
    if (state.quantity <= 0 || state.avg_cost <= 0) continue;
    rows.push(
      toDailyPnlRow(
        settlementDateForHistory(asset, state.date, timeZone),
        asset,
        navBased,
        state.avg_cost,
        state.avg_cost,
        state.quantity,
        state.avg_cost,
        state.total_fee,
        true,
        grossRealizedAsOf(lots, state.date),
      ),
    );
  }

  for (let i = 0; i < sortedPoints.length; i++) {
    const p = sortedPoints[i];
    const state = states[i];
    const realized = grossRealizedAsOf(lots, p.date);
    if (state.quantity <= 0) {
      // 持仓转为 0 的首个点：补一条「落袋已实现盈亏」行（qty=0，total = 已实现 − 累计费用），
      // 之后维持 0 的点跳过（carry-forward 保持）；再建仓时正常恢复（已实现已累计在内）。
      if (previousHeldClose != null) {
        const daily = computeTransactionAwareDailyPnl(p.close, previousHeldClose, state.quantity, sortedTxs, p.date, estimated);
        rows.push({
          ...toDailyPnlRow(
            settlementDateForHistory(asset, p.date, timeZone),
            asset,
            navBased,
            p.close,
            previousHeldClose,
            0,
            state.avg_cost,
            state.total_fee,
            estimated,
            realized,
          ),
          daily_pnl_amount: daily.computable ? daily.amount : null,
        });
      }
      previousHeldClose = null;
      continue;
    }

    // 当日盈亏按交易流水拆分基准：隔夜持仓用上一持仓日收盘，日内买入用成交价，日内卖出确认已实现日内价格变动。
    // 窗口首点若持仓早于历史窗口且无上一持仓日收盘，daily 仍记 null，避免把累计浮盈当成单日涨跌。
    const daily = computeTransactionAwareDailyPnl(
      p.close,
      previousHeldClose,
      state.quantity,
      sortedTxs,
      p.date,
      estimated,
    );
    rows.push({
      ...toDailyPnlRow(
        settlementDateForHistory(asset, p.date, timeZone),
        asset,
        navBased,
        p.close,
        previousHeldClose,
        state.quantity,
        state.avg_cost,
        state.total_fee,
        estimated,
        realized,
      ),
      daily_pnl_amount: daily.computable ? daily.amount : null,
    });
    previousHeldClose = p.close;
  }

  return rows;
}

function costStateDateForSnapshot(asset: Asset, snapshotDate: string, timeZone: string): string {
  if (isNavBased(asset)) return snapshotDate;
  return marketDateForSettlementDate(asset.market, snapshotDate, timeZone) ?? snapshotDate;
}

export function computeSnapshotTransactionAwareDailyPnl(
  snapshotDate: string,
  asset: Asset,
  close: number,
  prevClose: number | null,
  quantity: number,
  txs: Parameters<typeof buildDailyCostStates>[0],
  estimated = true,
  timeZone = currentSettlementTimezone(),
) {
  return computeTransactionAwareDailyPnl(
    close,
    prevClose,
    quantity,
    txs,
    costStateDateForSnapshot(asset, snapshotDate, timeZone),
    estimated,
  );
}

export interface RecomputeDailyPnlResult {
  asset_id: string;
  status: "ok" | "skipped" | "failed";
  rows: number;
  from: string | null;
  reason?: string;
}

/** 清理历史遗留的无效结算日快照（例如周日被实时快照误写入）。 */
export async function pruneInvalidDailyPnlRows(): Promise<number> {
  const timeZone = currentSettlementTimezone();
  const assets = await assetsRepo.list();
  const assetById = new Map(assets.map((a) => [a.id, a]));
  let removed = 0;
  for (const row of await dailyPnlRepo.listAll()) {
    const asset = assetById.get(row.asset_id);
    if (!asset || isValidSettlementSnapshotDate(asset, row.date, timeZone)) continue;
    await dailyPnlRepo.removeByAssetAndDate(row.asset_id, row.date);
    removed++;
  }
  return removed;
}

/** 交易变更后按交易流水 + 历史价格重算单资产 DailyPnL 派生快照 */
export async function recomputeDailyPnlForAsset(assetId: string): Promise<RecomputeDailyPnlResult> {
  const timeZone = currentSettlementTimezone();
  const asset = await assetsRepo.get(assetId);
  if (!asset) return { asset_id: assetId, status: "skipped", rows: 0, from: null, reason: "asset_not_found" };

  const txs = await transactionsRepo.listByAsset(assetId);
  if (txs.length === 0) {
    await dailyPnlRepo.removeByAsset(assetId);
    return { asset_id: assetId, status: "ok", rows: 0, from: null, reason: "no_transactions" };
  }

  const provider = getProvider();
  if (!provider.fetchHistory) {
    return { asset_id: assetId, status: "failed", rows: 0, from: null, reason: "history_provider_unavailable" };
  }

  const earliest = txs[0].trade_time.slice(0, 10);
  try {
    const res = await provider.fetchHistory(asset, dayDiffInclusive(earliest, todayStr(timeZone)));
    if (!res.ok) {
      return { asset_id: assetId, status: "failed", rows: 0, from: earliest, reason: res.reason };
    }
    const points = filterValidHistoryPointsForAsset(asset, res.data, timeZone).filter((p) => p.date >= earliest);
    const rows = buildTransactionAwareDailyPnlRows(asset, txs, points, true, timeZone)
      .filter((r) => isValidSettlementSnapshotDate(asset, r.date, timeZone));
    await dailyPnlRepo.replaceByAsset(assetId, rows);
    return { asset_id: assetId, status: "ok", rows: rows.length, from: earliest };
  } catch (e) {
    return {
      asset_id: assetId,
      status: "failed",
      rows: 0,
      from: earliest,
      reason: e instanceof Error ? e.message : "unknown_error",
    };
  }
}

/** 用当前持仓 + 最新行情按行情有效日写/更新快照（真实逐日累加） */
export async function snapshotToday(): Promise<void> {
  const timeZone = currentSettlementTimezone();
  const fallbackDate = todayStr(timeZone);
  const rows: NewDailyPnl[] = [];
  const assetById = new Map((await assetsRepo.list()).map((a) => [a.id, a]));
  const quoteById = new Map((await quotesRepo.all()).map((q) => [q.asset_id, q]));
  for (const p of await positionsRepo.list()) {
    if (p.quantity <= 0) continue;
    const asset = assetById.get(p.asset_id);
    if (!asset) continue;
    const quote = quoteById.get(asset.id);
    if (!quote) continue;
    const navBased = isNavBased(asset);
    const close = navBased ? quote.latest_nav : quote.latest_price;
    const prevClose = navBased ? quote.previous_nav : quote.previous_close;
    if (close == null) continue;
    if (!navBased && quote.market_status !== "closed") continue;
    if (!navBased && isBeforeRegularOpen(asset.market, quote)) continue;
    const snapshotDate = snapshotDateForQuote(asset, quote, fallbackDate, timeZone);
    if (!isValidSettlementSnapshotDate(asset, snapshotDate, timeZone)) {
      await dailyPnlRepo.removeByAssetAndDate(asset.id, snapshotDate);
      continue;
    }
    const carryForward = isCarryForwardSnapshot(snapshotDate, asset, quote, timeZone);
    const txs = await transactionsRepo.listByAsset(asset.id);
    const lots = walkRealized(txs as CostTx[]);
    const snapshotState = buildDailyCostStates(txs, [costStateDateForSnapshot(asset, snapshotDate, timeZone)])[0];
    if (snapshotState.quantity <= 0) {
      await dailyPnlRepo.removeByAssetAndDate(asset.id, snapshotDate);
      continue;
    }
    const row = toDailyPnlRow(
      snapshotDate,
      asset,
      navBased,
      close,
      prevClose,
      snapshotState.quantity,
      snapshotState.avg_cost,
      snapshotState.total_fee,
      quote.status === "estimated",
      grossRealizedAsOf(lots, costStateDateForSnapshot(asset, snapshotDate, timeZone)),
    );
    const previous = await dailyPnlRepo.latestBefore(asset.id, snapshotDate);
    const previousClose = navBased ? quote.previous_nav : quote.previous_close;
    const previousSnapshotDate = addDays(snapshotDate, -1);
    if (
      !carryForward &&
      isValidSettlementSnapshotDate(asset, previousSnapshotDate, timeZone) &&
      previousClose != null &&
      previousSnapshotDate >= (p.opened_at?.slice(0, 10) ?? previousSnapshotDate) &&
      previous?.date !== previousSnapshotDate
    ) {
      const state = buildDailyCostStates(txs, [costStateDateForSnapshot(asset, previousSnapshotDate, timeZone)])[0];
      if (state.quantity > 0) {
        const previousRow = toDailyPnlRow(
          previousSnapshotDate,
          asset,
          navBased,
          previousClose,
          null,
          state.quantity,
          state.avg_cost,
          state.total_fee,
          true,
          grossRealizedAsOf(lots, costStateDateForSnapshot(asset, previousSnapshotDate, timeZone)),
        );
        const previousForPreviousRow = await dailyPnlRepo.latestBefore(asset.id, previousSnapshotDate);
        rows.push({
          ...previousRow,
          daily_pnl_amount: snapshotDailyPnl(
            null,
            previousRow.total_pnl_amount,
            previousForPreviousRow?.total_pnl_amount,
          ),
        });
      }
    }
    const snapshotDaily = computeSnapshotTransactionAwareDailyPnl(
      snapshotDate,
      asset,
      close,
      prevClose,
      snapshotState.quantity,
      txs,
      quote.status === "estimated",
      timeZone,
    );
    const daily = carryForward
      ? 0
      : snapshotDaily.computable
        ? snapshotDaily.amount
        : snapshotDailyPnlForQuote(
            snapshotDate,
            asset,
            quote,
            row.daily_pnl_amount,
            row.total_pnl_amount,
            previous?.total_pnl_amount,
            timeZone,
          );
    rows.push({
      ...row,
      daily_pnl_amount: daily,
    });
  }
  if (rows.length > 0) await dailyPnlRepo.upsertMany(rows);
}

/** 由 Provider 历史回填近 days 天快照（标记估算），全新库 demo 用 */
export async function backfillHistory(days = 90): Promise<{ assets: number; rows: number }> {
  const timeZone = currentSettlementTimezone();
  const provider = getProvider();
  if (!provider.fetchHistory) return { assets: 0, rows: 0 };

  const rows: NewDailyPnl[] = [];
  let assetCount = 0;
  const assetById = new Map((await assetsRepo.list()).map((a) => [a.id, a]));
  for (const p of await positionsRepo.list()) {
    if (p.quantity <= 0) continue;
    const asset = assetById.get(p.asset_id);
    if (!asset) continue;
    const res = await provider.fetchHistory(asset, days);
    if (!res.ok || res.data.length === 0) continue;
    assetCount++;
    const navBased = isNavBased(asset);
    const points = filterValidHistoryPointsForAsset(asset, res.data, timeZone);
    if (points.length === 0) continue;
    for (let i = 0; i < points.length; i++) {
      const prev = i > 0 ? points[i - 1].close : null;
      rows.push(
        toDailyPnlRow(
          settlementDateForHistory(asset, points[i].date, timeZone),
          asset,
          navBased,
          points[i].close,
          prev,
          p.quantity,
          p.avg_cost,
          p.total_fee,
          true,
        ),
      );
    }
  }
  if (rows.length > 0) await dailyPnlRepo.upsertMany(rows);
  return { assets: assetCount, rows: rows.length };
}
