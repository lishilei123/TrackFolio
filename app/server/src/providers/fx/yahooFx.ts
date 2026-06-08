import type { Currency } from "../../domain/types.js";
import type { FxProvider, FxProviderResult } from "./types.js";
import { normalizeFromBase } from "./types.js";

const HOST = "https://query1.finance.yahoo.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

interface ChartResult {
  meta?: { regularMarketPrice?: number };
}

async function fetchPrice(symbol: string): Promise<number | null> {
  const url = `${HOST}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { chart?: { result?: ChartResult[] } };
  const n = json.chart?.result?.[0]?.meta?.regularMarketPrice;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

export class YahooFxProvider implements FxProvider {
  readonly name = "yahoo-fx";

  async fetchRates(currencies: Currency[]): Promise<FxProviderResult> {
    try {
      const base: Currency = "USD";
      const rates: Partial<Record<Currency, number>> = { USD: 1 };
      if (currencies.includes("CNY")) rates.CNY = await fetchPrice("USDCNY=X") ?? undefined;
      if (currencies.includes("HKD")) rates.HKD = await fetchPrice("USDHKD=X") ?? undefined;
      const rows = normalizeFromBase(base, rates, currencies, this.name);
      return rows ? { ok: true, data: rows } : { ok: false, reason: "unavailable" };
    } catch {
      return { ok: false, reason: "error" };
    }
  }
}
