import type { Asset, AssetType, Market } from "../domain/types.js";
import type { SecurityRef } from "./catalog.js";
import type { HistoryPoint, NavData, ProviderResult, QuoteData, QuoteProvider } from "./types.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const HOST = "https://api.nasdaq.com";

function addDays(date: string, n: number): string {
  const t = Date.parse(date + "T00:00:00.000Z");
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10);
}

function todayStr(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function parseNasdaqDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function parsePrice(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string") return null;
  const n = Number(value.replace(/[$,]/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseNasdaqHistoryRows(rows: unknown): HistoryPoint[] {
  if (!Array.isArray(rows)) return [];
  const byDate = new Map<string, number>();
  for (const row of rows) {
    const r = row as { date?: unknown; close?: unknown };
    const date = parseNasdaqDate(r.date);
    const close = parsePrice(r.close);
    if (date && close != null) byDate.set(date, close);
  }
  return [...byDate.entries()]
    .map(([date, close]) => ({ date, close }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function hasUsableNasdaqHistory(points: HistoryPoint[], toDate: string): boolean {
  if (points.length === 0) return false;
  const newest = points[points.length - 1].date;
  if (newest > toDate) return false;
  if (Date.parse(toDate + "T00:00:00.000Z") - Date.parse(newest + "T00:00:00.000Z") > 10 * 86_400_000) {
    return false;
  }
  for (let i = 1; i < points.length; i++) {
    if (points[i].date <= points[i - 1].date) return false;
    const gap = Date.parse(points[i].date + "T00:00:00.000Z") - Date.parse(points[i - 1].date + "T00:00:00.000Z");
    if (gap > 10 * 86_400_000) return false;
  }
  return true;
}

function assetClasses(asset: Asset): string[] {
  if (asset.asset_type === "FUND" && asset.fund_type === "etf") return ["etf", "stocks"];
  return ["stocks", "etf"];
}

async function getJson(url: string, referer: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
      Referer: referer,
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

export class NasdaqHistoryProvider implements QuoteProvider {
  readonly name = "nasdaq-history";

  async fetchQuote(_asset: Asset): Promise<ProviderResult<QuoteData>> {
    return { ok: false, reason: "unavailable" };
  }

  async fetchNav(_asset: Asset): Promise<ProviderResult<NavData>> {
    return { ok: false, reason: "unavailable" };
  }

  async fetchHistory(asset: Asset, days: number): Promise<ProviderResult<HistoryPoint[]>> {
    if (asset.market !== "US" || (asset.asset_type === "FUND" && asset.fund_type === "otc")) {
      return { ok: false, reason: "unavailable" };
    }

    const symbol = asset.symbol.toUpperCase();
    const toDate = todayStr();
    const fromDate = addDays(toDate, -Math.max(days + 7, 14));
    for (const assetClass of assetClasses(asset)) {
      try {
        const url =
          `${HOST}/api/quote/${encodeURIComponent(symbol)}/historical?` +
          new URLSearchParams({
            assetclass: assetClass,
            fromdate: fromDate,
            todate: toDate,
            limit: "9999",
          }).toString();
        const referer = `https://www.nasdaq.com/market-activity/${assetClass}/${symbol.toLowerCase()}/historical`;
        const json = await getJson(url, referer) as { data?: { tradesTable?: { rows?: unknown } } };
        const points = parseNasdaqHistoryRows(json.data?.tradesTable?.rows);
        if (hasUsableNasdaqHistory(points, toDate)) return { ok: true, data: points };
      } catch {
        /* try the next Nasdaq asset class */
      }
    }
    return { ok: false, reason: "unavailable" };
  }

  async search(
    _query: string,
    _opts: { market?: Market; asset_type?: AssetType; limit?: number } = {},
  ): Promise<SecurityRef[]> {
    return [];
  }
}
