import assert from "node:assert/strict";
import { test } from "node:test";
import type { Asset } from "../domain/types.js";
import { AutoProvider } from "./auto.js";
import type { HistoryPoint, NavData, ProviderResult, QuoteData, QuoteProvider } from "./types.js";

function asset(over: Partial<Asset> = {}): Asset {
  return {
    id: "a1",
    asset_type: "STOCK",
    market: "US",
    symbol: "HYLN",
    name: "Hyliion",
    currency: "USD",
    exchange: null,
    fund_type: null,
    quote_status: "ok",
    created_at: "",
    updated_at: "",
    ...over,
  };
}

function quoteData(): QuoteData {
  return {
    latest_price: 6.9,
    previous_close: 7.62,
    pre_previous_close: null,
    open: 7.66,
    high: 7.97,
    low: 6.87,
    volume: 8_252_308,
    change_amount: -0.72,
    change_percent: -9.45,
    market_status: "closed",
    quote_time: "2026-06-05T20:00:00.000Z",
  };
}

function provider(over: Partial<QuoteProvider>): QuoteProvider {
  return {
    name: "mock",
    fetchQuote: async (): Promise<ProviderResult<QuoteData>> => ({ ok: false, reason: "unavailable" }),
    fetchNav: async (): Promise<ProviderResult<NavData>> => ({ ok: false, reason: "unavailable" }),
    fetchHistory: async (): Promise<ProviderResult<HistoryPoint[]>> => ({ ok: false, reason: "unavailable" }),
    ...over,
  };
}

test("history fallbacks are not used for realtime quote refresh", async () => {
  let fallbackQuoteCalls = 0;
  let fallbackHistoryCalls = 0;
  const primary = provider({
    name: "primary",
    fetchQuote: async () => ({ ok: true, data: quoteData() }),
    fetchHistory: async () => ({ ok: false, reason: "unavailable" }),
  });
  const historyFallback = provider({
    name: "nasdaq-history",
    fetchQuote: async () => {
      fallbackQuoteCalls++;
      return { ok: true, data: quoteData() };
    },
    fetchHistory: async () => {
      fallbackHistoryCalls++;
      return { ok: true, data: [{ date: "2026-06-05", close: 6.9 }] };
    },
  });

  const auto = new AutoProvider([primary], [historyFallback]);
  const quote = await auto.fetchQuote(asset());
  const history = await auto.fetchHistory(asset(), 5);

  assert.equal(quote.ok, true);
  assert.equal(history.ok, true);
  assert.equal(fallbackQuoteCalls, 0);
  assert.equal(fallbackHistoryCalls, 1);
});

test("CN and HK realtime quotes skip yahoo", async () => {
  let yahooCalls = 0;
  const sina = provider({ name: "sina" });
  const yahoo = provider({
    name: "yahoo",
    fetchQuote: async () => {
      yahooCalls++;
      return { ok: true, data: quoteData() };
    },
  });
  const auto = new AutoProvider([sina, yahoo]);

  const cn = await auto.fetchQuote(asset({ market: "CN", symbol: "600519", currency: "CNY" }));
  const hk = await auto.fetchQuote(asset({ market: "HK", symbol: "00700", currency: "HKD" }));

  assert.equal(cn.ok, false);
  assert.equal(hk.ok, false);
  assert.equal(yahooCalls, 0);
});
