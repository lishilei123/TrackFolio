import type { Asset, AssetType, Currency, Market, MarketStatus } from "../domain/types.js";
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

async function fetchChart(ysym: string, range: string): Promise<ChartResult | null> {
  const url = `${HOST}/v8/finance/chart/${encodeURIComponent(ysym)}?range=${range}&interval=1d`;
  const j = (await getJson(url)) as { chart?: { result?: ChartResult[] } };
  return j.chart?.result?.[0] ?? null;
}

export class YahooProvider implements QuoteProvider {
  readonly name = "yahoo";

  async fetchQuote(asset: Asset): Promise<ProviderResult<QuoteData>> {
    try {
      const r = await fetchChart(yahooSymbol(asset), "5d");
      const meta = r?.meta;
      const latest = num(meta?.regularMarketPrice);
      const prevClose = num(meta?.chartPreviousClose) ?? num(meta?.previousClose);
      if (latest == null || latest <= 0 || prevClose == null || prevClose <= 0) {
        return { ok: false, reason: "unavailable" };
      }
      const q = r?.indicators?.quote?.[0];
      const closes = q?.close ?? [];
      // pre_previous_close：日线 close 倒数第三个（最后一个≈今天，倒数第二≈前收）
      let prePrev: number | null = null;
      const valid = closes.filter((c) => c != null && Number.isFinite(c)) as number[];
      if (valid.length >= 3) prePrev = valid[valid.length - 3];

      const changeAmount = round(latest - prevClose, 4);
      const changePercent = round((changeAmount / prevClose) * 100, 2);
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
          market_status: mapMarketState(meta?.marketState),
          quote_time: new Date().toISOString(),
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
