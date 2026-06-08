import type { Asset, Currency, QuoteSnapshot } from "../domain/types.js";
import { getProvider } from "../providers/index.js";
import { assetsRepo } from "../repositories/assets.js";
import { dailyPnlRepo } from "../repositories/dailyPnl.js";
import type { DailyPnlRow, NewDailyPnl } from "../repositories/dailyPnl.js";
import { positionsRepo } from "../repositories/positions.js";
import { quotesRepo } from "../repositories/quotes.js";
import { transactionsRepo } from "../repositories/transactions.js";
import { fxService } from "./fx.js";
import { buildDailyCostStates } from "./position.js";
import { computeHolding, isNavBased } from "./pnl.js";

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

function todayStr(): string {
  return beijingDateFromInstant(new Date().toISOString()) ?? new Date().toISOString().slice(0, 10);
}

function datePart(value: string | null | undefined): string | null {
  if (!value) return null;
  const direct = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (direct) return direct;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

function beijingDateFromInstant(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return datePart(value);
  return new Date(t + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 在 YYYY-MM-DD 上加 n 天（纯函数，UTC 安全） */
function addDays(date: string, n: number): string {
  const t = Date.parse(date + "T00:00:00.000Z");
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * 历史 K 线日期（美股自然日）→ 北京结算日。
 * 美股一场收于次一北京日（EST 16:00→次日05:00北京；EDT 16:00→次日04:00北京），故偏移恒为 +1，
 * 使历史重算与按北京结算日记账的实时快照/看板（同键 (date, asset_id)）对齐。仅 US 非 nav 资产偏移。
 */
function settlementDateForHistory(
  asset: Pick<Asset, "market" | "asset_type" | "fund_type">,
  usCalendarDate: string,
): string {
  return asset.market === "US" && !isNavBased(asset) ? addDays(usCalendarDate, 1) : usCalendarDate;
}

function quoteEffectiveDate(
  asset: Pick<Asset, "asset_type" | "fund_type">,
  quote: Pick<QuoteSnapshot, "nav_date" | "quote_time"> & Partial<Pick<QuoteSnapshot, "market_status">>,
): string | null {
  if (isNavBased(asset)) return datePart(quote.nav_date) ?? beijingDateFromInstant(quote.quote_time);
  if (quote.market_status !== "closed") return null;
  return beijingDateFromInstant(quote.quote_time);
}

export function snapshotDateForQuote(
  asset: Pick<Asset, "asset_type" | "fund_type">,
  quote: Pick<QuoteSnapshot, "nav_date" | "quote_time"> & Partial<Pick<QuoteSnapshot, "market_status">>,
  fallbackDate = todayStr(),
): string {
  const effectiveDate = quoteEffectiveDate(asset, quote);
  if (!effectiveDate) return fallbackDate;
  return effectiveDate < fallbackDate ? fallbackDate : effectiveDate;
}

export function isCarryForwardSnapshot(
  snapshotDate: string,
  asset: Pick<Asset, "asset_type" | "fund_type">,
  quote: Pick<QuoteSnapshot, "nav_date" | "quote_time"> & Partial<Pick<QuoteSnapshot, "market_status">>,
): boolean {
  const effectiveDate = quoteEffectiveDate(asset, quote);
  return effectiveDate != null && effectiveDate < snapshotDate;
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
  asset: Pick<Asset, "asset_type" | "fund_type">,
  quote: Pick<QuoteSnapshot, "nav_date" | "quote_time"> & Partial<Pick<QuoteSnapshot, "market_status">>,
  quoteDaily: number | null,
  total: number | null,
  previousTotal: number | null | undefined,
): number | null {
  return isCarryForwardSnapshot(snapshotDate, asset, quote)
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

/**
 * 用当前持仓 + 最新行情合成「今日」实时快照行（原币，累计盈亏时点值）。
 * 让账户盈亏走势的最后一个点跟随实时行情，而不是停在上一交易日收盘快照。
 */
async function liveTodayRows(
  date: string,
  settlement: Currency,
  todaySnapshots: DailyPnlRow[],
  assetId?: string | null,
): Promise<DailyPnlRow[]> {
  const assetById = new Map((await assetsRepo.list()).map((a) => [a.id, a]));
  const quoteById = new Map((await quotesRepo.all()).map((q) => [q.asset_id, q]));
  const todayByAsset = new Map(todaySnapshots.map((r) => [r.asset_id, r]));
  const rows: DailyPnlRow[] = [];
  for (const p of await positionsRepo.list()) {
    if (p.quantity <= 0) continue;
    if (assetId && p.asset_id !== assetId) continue;
    const asset = assetById.get(p.asset_id);
    if (!asset) continue;
    const quote = quoteById.get(asset.id);
    if (!quote) continue;
    const navBased = isNavBased(asset);
    const latest = navBased ? quote.latest_nav : quote.latest_price;
    if (latest == null) continue;
    const holding = computeHolding(asset, p, quote, settlement, todayByAsset.get(asset.id) ?? null);
    rows.push({
      date,
      asset_id: asset.id,
      market: asset.market,
      asset_type: asset.asset_type,
      quantity: p.quantity,
      close_price: navBased ? null : latest,
      nav: navBased ? latest : null,
      daily_pnl_amount: holding.today_pnl.computable ? holding.today_pnl.amount : null,
      total_pnl_amount: (latest - p.avg_cost) * p.quantity - p.total_fee,
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
  const stored = asset_id
    ? await dailyPnlRepo.listByAsset(asset_id, from, to)
    : await dailyPnlRepo.listRange(from, to);

  // 今日在区间内时，用实时行情覆盖今日快照行，使走势最后一个点实时。
  const today = todayStr();
  let rows = stored;
  if (from <= today && today <= to) {
    const live = await liveTodayRows(today, settlement, stored.filter((r) => r.date === today), asset_id);
    if (live.length > 0) rows = [...stored.filter((r) => r.date !== today), ...live];
  }

  // 预加载资产名，使 aggregateHistory 的 nameOf 回调保持同步（纯函数）。
  const nameMap = new Map((await assetsRepo.list()).map((a) => [a.id, a.name || a.symbol]));
  const nameOf = (id: string): string => nameMap.get(id) ?? id;
  const getRate = (f: Currency, t: Currency): number | null => {
    const info = fxService.getRate(f, t);
    return info.available ? info.rate : null;
  };

  const agg = aggregateHistory(rows, settlement, granularity, getRate, nameOf);
  return { from, to, settlement_currency: settlement, asset_id: asset_id ?? null, ...agg };
}

/** 把单个资产的一日盈亏算成快照行（原币） */
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
): NewDailyPnl {
  const daily = prevClose != null ? (close - prevClose) * qty : null;
  const total = (close - avgCost) * qty - fee;
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

export function buildTransactionAwareDailyPnlRows(
  asset: Asset,
  txs: Parameters<typeof buildDailyCostStates>[0],
  points: Array<{ date: string; close: number }>,
  estimated = true,
): NewDailyPnl[] {
  const navBased = isNavBased(asset);
  const sortedTxs = [...txs].sort((a, b) => a.trade_time.localeCompare(b.trade_time));
  const sortedPoints = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const states = buildDailyCostStates(sortedTxs, sortedPoints.map((p) => p.date));
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
        settlementDateForHistory(asset, state.date),
        asset,
        navBased,
        state.avg_cost,
        state.avg_cost,
        state.quantity,
        state.avg_cost,
        state.total_fee,
        true,
      ),
    );
  }

  for (let i = 0; i < sortedPoints.length; i++) {
    const p = sortedPoints[i];
    const state = states[i];
    if (state.quantity <= 0) {
      previousHeldClose = null;
      continue;
    }

    // 当日盈亏基准（“上一持仓日收盘价”）：
    // - 有上一持仓日收盘：正常持仓日，直接相减。
    // - 无上一持仓日收盘：
    //   · 建仓/重新建仓首日（窗口内由空仓转为持仓，i>0 必经空仓点；i===0 时其开仓日就在当日）：
    //     用买入均价做基准（README：建仓首日按 收盘 - 买入均价），避免把未持有期间的行情涨跌计入收益。
    //   · 窗口首点但持仓早于历史窗口（K 线被截断）：缺少真实上一持仓日收盘，当日盈亏不可计算（记 null）。
    //     绝不能拿买入均价当昨收——否则会把建仓至今的累计浮盈错算成单日涨跌。
    let prevForDaily: number | null;
    if (previousHeldClose != null) {
      prevForDaily = previousHeldClose;
    } else if (i === 0 && state.opened_at?.slice(0, 10) !== p.date) {
      prevForDaily = null;
    } else {
      prevForDaily = state.avg_cost;
    }
    rows.push(
      toDailyPnlRow(
        settlementDateForHistory(asset, p.date),
        asset,
        navBased,
        p.close,
        prevForDaily,
        state.quantity,
        state.avg_cost,
        state.total_fee,
        estimated,
      ),
    );
    previousHeldClose = p.close;
  }

  return rows;
}

function costStateDateForSnapshot(asset: Asset, snapshotDate: string): string {
  return asset.market === "US" && !isNavBased(asset) ? addDays(snapshotDate, -1) : snapshotDate;
}

export interface RecomputeDailyPnlResult {
  asset_id: string;
  status: "ok" | "skipped" | "failed";
  rows: number;
  from: string | null;
  reason?: string;
}

/** 交易变更后按交易流水 + 历史价格重算单资产 DailyPnL 派生快照 */
export async function recomputeDailyPnlForAsset(assetId: string): Promise<RecomputeDailyPnlResult> {
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
    const res = await provider.fetchHistory(asset, dayDiffInclusive(earliest, todayStr()));
    if (!res.ok) {
      return { asset_id: assetId, status: "failed", rows: 0, from: earliest, reason: res.reason };
    }
    const points = res.data.filter((p) => p.date >= earliest);
    const rows = buildTransactionAwareDailyPnlRows(asset, txs, points, true);
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
  const fallbackDate = todayStr();
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
    const snapshotDate = snapshotDateForQuote(asset, quote, fallbackDate);
    const carryForward = isCarryForwardSnapshot(snapshotDate, asset, quote);
    const row = toDailyPnlRow(
      snapshotDate,
      asset,
      navBased,
      close,
      prevClose,
      p.quantity,
      p.avg_cost,
      p.total_fee,
      quote.status === "estimated",
    );
    const previous = await dailyPnlRepo.latestBefore(asset.id, snapshotDate);
    const previousClose = navBased ? quote.previous_nav : quote.previous_close;
    const previousSnapshotDate = addDays(snapshotDate, -1);
    if (
      !carryForward &&
      previousClose != null &&
      previousSnapshotDate >= (p.opened_at?.slice(0, 10) ?? previousSnapshotDate) &&
      previous?.date !== previousSnapshotDate
    ) {
      const txs = await transactionsRepo.listByAsset(asset.id);
      const state = buildDailyCostStates(txs, [costStateDateForSnapshot(asset, previousSnapshotDate)])[0];
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
    const daily = snapshotDailyPnlForQuote(
      snapshotDate,
      asset,
      quote,
      row.daily_pnl_amount,
      row.total_pnl_amount,
      previous?.total_pnl_amount,
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
    const points = res.data;
    for (let i = 0; i < points.length; i++) {
      const prev = i > 0 ? points[i - 1].close : null;
      rows.push(
        toDailyPnlRow(
          settlementDateForHistory(asset, points[i].date),
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
