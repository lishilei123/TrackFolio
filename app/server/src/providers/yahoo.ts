import { marketStatusFor } from "../domain/marketHours.js";
import type { Asset, AssetType, Currency, Market, MarketStatus } from "../domain/types.js";
import { settingsRepo } from "../repositories/settings.js";
import type { SecurityRef } from "./catalog.js";
import type { HistoryPoint, NavData, ProviderResult, QuoteData, QuoteProvider } from "./types.js";

/**
 * Yahoo Finance Provider —— 面向「国外部署」的免费、无 key 行情源。
 * - 实时/历史：/v8/finance/chart（无需 crumb，国外最稳）
 * - 搜索：/v1/finance/search（best-effort，仅英文/代码；失败返回空）
 * 不实现 fetchNav：Yahoo 无中国场外开放式基金净值，由 AutoProvider 落回 sina。
 * 注：Yahoo 封禁中国大陆 IP，本机无法验证；防御式解析，靠 AutoProvider 兜底。
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const HOST = "https://query1.finance.yahoo.com";

const CNY: Currency = "CNY";
const USD: Currency = "USD";
const HKD: Currency = "HKD";

async function getJson(url: string, timeoutMs = 8000): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function num(x: unknown): number | null {
  const n = typeof x === "string" ? Number(x) : (x as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function round(n: number, d = 4): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

/** 由市场 + symbol 构造 Yahoo 代码 */
function yahooSymbol(asset: Asset): string {
  if (asset.market === "US") return asset.symbol.toUpperCase();
  if (asset.market === "HK") {
    const digits = asset.symbol.replace(/^0+/, "").padStart(4, "0"); // 00700 → 0700
    return digits + ".HK";
  }
  // CN：首位 5/6/9 → 沪市 .SS，否则深市 .SZ
  return asset.symbol + (/^[569]/.test(asset.symbol) ? ".SS" : ".SZ");
}

/** Yahoo marketState → 我们的 MarketStatus */
function mapMarketState(s: unknown): MarketStatus {
  switch (s) {
    case "REGULAR":
      return "open";
    case "PRE":
    case "PREPRE":
      return "pre";
    case "POST":
    case "POSTPOST":
      return "post";
    case "CLOSED":
      return "closed";
    default:
      return "unknown";
  }
}

/** Yahoo exchange 代码 → 市场（仅保留支持的） */
function mapExchange(ex: string): { market: Market; currency: Currency } | null {
  const US = new Set(["NMS", "NYQ", "NGM", "NCM", "ASE", "PCX", "BATS", "Nced", "NIM"]);
  if (US.has(ex)) return { market: "US", currency: USD };
  if (ex === "HKG") return { market: "HK", currency: HKD };
  if (ex === "SHH" || ex === "SHZ") return { market: "CN", currency: CNY };
  return null;
}

/** days → Yahoo range 档位 */
function rangeFor(days: number): string {
  if (days <= 5) return "5d";
  if (days <= 30) return "1mo";
  if (days <= 90) return "3mo";
  if (days <= 180) return "6mo";
  if (days <= 365) return "1y";
  return "2y";
}

interface ChartResult {
  meta?: {
    regularMarketPrice?: number;
    regularMarketTime?: number;
    preMarketPrice?: number;
    preMarketTime?: number;
    postMarketPrice?: number;
    postMarketTime?: number;
    chartPreviousClose?: number;
    previousClose?: number;
    marketState?: string;
  };
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      open?: (number | null)[];
      high?: (number | null)[];
      low?: (number | null)[];
      close?: (number | null)[];
      volume?: (number | null)[];
    }>;
  };
}

/** 取数组中最后一个非空值 */
function lastValid(arr: (number | null)[] | undefined): number | null {
  if (!arr) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != null && Number.isFinite(arr[i] as number)) return arr[i] as number;
  }
  return null;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function previousClosesFromDaily(
  closes: (number | null)[] | undefined,
  marketState?: string,
): {
  previousClose: number | null;
  prePreviousClose: number | null;
  prePrePreviousClose: number | null;
} {
  if (!closes || closes.length === 0) {
    return { previousClose: null, prePreviousClose: null, prePrePreviousClose: null };
  }

  const finalCloseIncluded = isFiniteNumber(closes[closes.length - 1]);
  const historicalOnlyPremarket = marketState === "PRE" || marketState === "PREPRE";
  let previousIndex = -1;
  let prePreviousIndex = -1;
  let prePrePreviousIndex = -1;

  if (finalCloseIncluded && !historicalOnlyPremarket) {
    for (let i = closes.length - 2; i >= 0; i--) {
      if (isFiniteNumber(closes[i])) {
        previousIndex = i;
        break;
      }
    }
  } else {
    for (let i = closes.length - 1; i >= 0; i--) {
      if (isFiniteNumber(closes[i])) {
        previousIndex = i;
        break;
      }
    }
  }

  for (let i = previousIndex - 1; i >= 0; i--) {
    if (isFiniteNumber(closes[i])) {
      prePreviousIndex = i;
      break;
    }
  }

  for (let i = prePreviousIndex - 1; i >= 0; i--) {
    if (isFiniteNumber(closes[i])) {
      prePrePreviousIndex = i;
      break;
    }
  }

  return {
    previousClose: previousIndex >= 0 ? closes[previousIndex] : null,
    prePreviousClose: prePreviousIndex >= 0 ? closes[prePreviousIndex] : null,
    prePrePreviousClose: prePrePreviousIndex >= 0 ? closes[prePrePreviousIndex] : null,
  };
}

function usLocalDateFromUnix(value: number | null): string | null {
  if (value == null) return null;
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function usExtendedSession(extendedTime: number | null, regularTime: number | null): "pre" | "post" | null {
  if (extendedTime == null) return null;
  if (regularTime != null && extendedTime < regularTime) return null;

  const extendedDate = usLocalDateFromUnix(extendedTime);
  const regularDate = usLocalDateFromUnix(regularTime);
  if (extendedDate && regularDate) {
    if (extendedDate > regularDate) return "pre";
    if (extendedDate === regularDate) return "post";
  }
  return null;
}

function latestFromMeta(
  meta: ChartResult["meta"],
  allowPremarket = true,
  allowPostmarket = true,
): { price: number | null; time: number | null; session: "pre" | "post" | null } {
  const regularPrice = num(meta?.regularMarketPrice);
  const regularTime = num(meta?.regularMarketTime);
  const prePrice = num(meta?.preMarketPrice);
  const preTime = num(meta?.preMarketTime);
  const postPrice = num(meta?.postMarketPrice);
  const postTime = num(meta?.postMarketTime);
  const marketState = meta?.marketState;
  const preSession =
    marketState === "PRE" || marketState === "PREPRE" || usExtendedSession(preTime, regularTime) === "pre";
  const postSession =
    marketState === "POST" || marketState === "POSTPOST" || usExtendedSession(postTime, regularTime) === "post";

  const candidates: Array<{ price: number; time: number | null; session: "pre" | "post" }> = [];
  if (allowPremarket && preSession && prePrice != null) candidates.push({ price: prePrice, time: preTime, session: "pre" });
  if (allowPostmarket && postSession && postPrice != null) candidates.push({ price: postPrice, time: postTime, session: "post" });
  candidates.sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
  const latest = candidates[0];
  if (latest) return latest;

  return { price: regularPrice, time: regularTime, session: null };
}

function defaultUseUsPremarketPnl(): boolean {
  try {
    return settingsRepo.getDisplay().use_us_premarket_pnl;
  } catch {
    return true;
  }
}

function defaultUseUsPostmarketPnl(): boolean {
  try {
    return settingsRepo.getDisplay().use_us_postmarket_pnl;
  } catch {
    return true;
  }
}

interface IntradayPoint {
  price: number;
  time: number;
}

function lastIntradayPoint(result: ChartResult | null): IntradayPoint | null {
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  for (let i = Math.min(timestamps.length, closes.length) - 1; i >= 0; i--) {
    const price = closes[i];
    const time = timestamps[i];
    if (isFiniteNumber(price) && Number.isFinite(time)) return { price, time };
  }
  return null;
}

async function fetchChart(
  ysym: string,
  range: string,
  interval = "1d",
  includePrePost = false,
): Promise<ChartResult | null> {
  const qs = new URLSearchParams({ range, interval });
  if (includePrePost) qs.set("includePrePost", "true");
  const url = `${HOST}/v8/finance/chart/${encodeURIComponent(ysym)}?${qs.toString()}`;
  const j = (await getJson(url)) as { chart?: { result?: ChartResult[] } };
  return j.chart?.result?.[0] ?? null;
}

export class YahooProvider implements QuoteProvider {
  readonly name = "yahoo";

  constructor(
    private readonly options: {
      now?: () => Date;
      useUsPremarketPnl?: () => boolean;
      useUsPostmarketPnl?: () => boolean;
    } = {},
  ) {}

  private useUsPremarketPnl(): boolean {
    return this.options.useUsPremarketPnl?.() ?? defaultUseUsPremarketPnl();
  }

  private useUsPostmarketPnl(): boolean {
    return this.options.useUsPostmarketPnl?.() ?? defaultUseUsPostmarketPnl();
  }

  async fetchQuote(asset: Asset): Promise<ProviderResult<QuoteData>> {
    try {
      const ysym = yahooSymbol(asset);
      const localStatus = marketStatusFor(asset.market, this.options.now?.() ?? new Date());
      const r = await fetchChart(ysym, "5d");
      const meta = r?.meta;
      const marketState = meta?.marketState;
      const metaPre = marketState === "PRE" || marketState === "PREPRE";
      const metaPost = marketState === "POST" || marketState === "POSTPOST";
      const regularTime = num(meta?.regularMarketTime);
      const metaPreByTime = usExtendedSession(num(meta?.preMarketTime), regularTime) === "pre";
      const metaPostByTime = usExtendedSession(num(meta?.postMarketTime), regularTime) === "post";
      const isPremarketQuote = asset.market === "US" && (localStatus === "pre" || metaPre || metaPreByTime);
      const isPostmarketQuote = asset.market === "US" && (localStatus === "post" || metaPost || metaPostByTime);
      const usePremarket = !isPremarketQuote || this.useUsPremarketPnl();
      const usePostmarket = !isPostmarketQuote || this.useUsPostmarketPnl();
      const latestQuote = latestFromMeta(meta, usePremarket, usePostmarket);
      let latest = latestQuote.price;
      let latestTime = latestQuote.time;
      let latestSession = latestQuote.session;
      const needsPremarketIntraday =
        usePremarket && (localStatus === "pre" || metaPreByTime) && latestSession !== "pre";
      const needsPostmarketIntraday =
        usePostmarket && (localStatus === "post" || metaPost || metaPostByTime);
      const shouldFetchIntraday =
        asset.market === "US" && (needsPremarketIntraday || needsPostmarketIntraday);
      if (shouldFetchIntraday) {
        const intraday = lastIntradayPoint(await fetchChart(ysym, "1d", "1m", true));
        if (intraday) {
          latest = intraday.price;
          latestTime = intraday.time;
          latestSession = latestSession ?? (isPremarketQuote && !isPostmarketQuote ? "pre" : "post");
        }
      }
      const q = r?.indicators?.quote?.[0];
      const closes = q?.close ?? [];
      const effectiveMarketState = meta?.marketState ?? (asset.market === "US" && isPremarketQuote ? "PRE" : undefined);
      const dailyCloses = previousClosesFromDaily(closes, effectiveMarketState);
      let prevClose = dailyCloses.previousClose ?? num(meta?.previousClose) ?? num(meta?.chartPreviousClose);
      let prePrev = dailyCloses.prePreviousClose;
      if (isPremarketQuote && !usePremarket && prevClose != null) {
        latest = prevClose;
        latestTime = num(meta?.regularMarketTime) ?? latestTime;
        prevClose = dailyCloses.prePreviousClose ?? num(meta?.previousClose) ?? num(meta?.chartPreviousClose);
        prePrev = dailyCloses.prePrePreviousClose;
      }
      if (latest == null || latest <= 0 || prevClose == null || prevClose <= 0) {
        return { ok: false, reason: "unavailable" };
      }

      const changeAmount = round(latest - prevClose, 4);
      const changePercent = round((changeAmount / prevClose) * 100, 2);
      const quoteTime =
        latestTime != null
          ? new Date(latestTime * 1000).toISOString()
          : new Date().toISOString();
      const marketStatus = mapMarketState(meta?.marketState);
      const reportedMarketStatus = marketStatus === "unknown" && asset.market === "US" ? localStatus : marketStatus;
      return {
        ok: true,
        data: {
          latest_price: latest,
          previous_close: prevClose,
          pre_previous_close: prePrev,
          open: lastValid(q?.open) ?? latest,
          high: lastValid(q?.high) ?? latest,
          low: lastValid(q?.low) ?? latest,
          volume: lastValid(q?.volume) ?? 0,
          change_amount: changeAmount,
          change_percent: changePercent,
          market_status: reportedMarketStatus,
          quote_time: quoteTime,
        },
      };
    } catch {
      return { ok: false, reason: "unavailable" };
    }
  }

  /** Yahoo 无中国场外开放式基金净值 → 恒返回 unavailable，由 AutoProvider 落回 sina */
  async fetchNav(_asset: Asset): Promise<ProviderResult<NavData>> {
    return { ok: false, reason: "unavailable" };
  }

  async fetchHistory(asset: Asset, days: number): Promise<ProviderResult<HistoryPoint[]>> {
    try {
      const r = await fetchChart(yahooSymbol(asset), rangeFor(days));
      const ts = r?.timestamp;
      const closes = r?.indicators?.quote?.[0]?.close;
      if (!ts || !closes || ts.length === 0) return { ok: false, reason: "unavailable" };
      const points: HistoryPoint[] = [];
      for (let i = 0; i < ts.length; i++) {
        const c = closes[i];
        if (c == null || !Number.isFinite(c)) continue;
        const date = new Date(ts[i] * 1000).toISOString().slice(0, 10);
        points.push({ date, close: c });
      }
      return points.length > 0 ? { ok: true, data: points } : { ok: false, reason: "unavailable" };
    } catch {
      return { ok: false, reason: "unavailable" };
    }
  }

  async search(
    query: string,
    opts: { market?: Market; asset_type?: AssetType; limit?: number } = {},
  ): Promise<SecurityRef[]> {
    const q = query.trim();
    if (!q) return [];
    const limit = opts.limit ?? 20;
    let quotes: Array<Record<string, unknown>>;
    try {
      const url = `${HOST}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=20&newsCount=0`;
      const j = (await getJson(url)) as { quotes?: Array<Record<string, unknown>> };
      quotes = j.quotes ?? [];
    } catch {
      return []; // best-effort：失败交给 AutoProvider 落回 sina
    }

    const out: SecurityRef[] = [];
    for (const it of quotes) {
      const ex = mapExchange(String(it.exchange ?? ""));
      if (!ex) continue;
      const qt = String(it.quoteType ?? "");
      let asset_type: AssetType;
      let fund_type: string | null = null;
      if (qt === "EQUITY") asset_type = "STOCK";
      else if (qt === "ETF") {
        asset_type = "FUND";
        fund_type = "etf";
      } else if (qt === "MUTUALFUND") {
        asset_type = "FUND";
        fund_type = "otc";
      } else continue;

      // 去交易所后缀，存规范代码（HK 补 5 位与 sina 对齐）
      let symbol = String(it.symbol ?? "").split(".")[0].toUpperCase();
      if (!symbol) continue;
      if (ex.market === "HK") symbol = symbol.padStart(5, "0");
      const name = String(it.shortname ?? it.longname ?? symbol);

      if (opts.market && ex.market !== opts.market) continue;
      if (opts.asset_type && asset_type !== opts.asset_type) continue;
      out.push({ asset_type, market: ex.market, symbol, name, currency: ex.currency, fund_type });
      if (out.length >= limit) break;
    }
    return out;
  }
}
