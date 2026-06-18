import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { Asset } from "../domain/types.js";
import { marketStatusFor, SinaProvider } from "./sina.js";

function asset(over: Partial<Asset> = {}): Asset {
  return {
    id: "a1",
    asset_type: "STOCK",
    market: "US",
    symbol: "QQQ",
    name: "Invesco QQQ Trust",
    currency: "USD",
    exchange: null,
    fund_type: null,
    quote_status: "ok",
    created_at: "",
    updated_at: "",
    ...over,
  };
}

function sinaUsQuoteLine(overrides: Record<number, string>): string {
  const fields = Array.from({ length: 30 }, () => "");
  fields[0] = "QQQ";
  for (const [key, value] of Object.entries(overrides)) {
    fields[Number(key)] = value;
  }
  return `var hq_str_gb_qqq="${fields.join(",")}";`;
}

function mockQuoteFetch(t: TestContext, body: string): void {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("hq.sinajs.cn")) return new Response(body, { status: 200 });
    return new Response("{}", { status: 500 });
  }) as typeof fetch;
}

const SINA_US_PREMARKET_BODY = sinaUsQuoteLine({
  1: "729.8600",
  2: "-1.90",
  4: "-14.1400",
  5: "734.4500",
  6: "736.0000",
  7: "728.0000",
  10: "1000000",
  21: "733.5600",
  22: "0.51",
  23: "3.70",
  24: "Jun 17 05:57AM EDT",
  25: "Jun 16 04:00PM EDT",
  26: "744.0000",
  27: "318107",
  29: "2026",
});

const SINA_US_CLOSED_BODY = sinaUsQuoteLine({
  1: "729.8600",
  2: "-1.90",
  4: "-14.1400",
  5: "734.4500",
  6: "736.0000",
  7: "728.0000",
  10: "1000000",
  25: "Jun 16 04:00PM EDT",
  26: "744.0000",
  29: "2026",
});

test("US market status uses New York regular-session boundaries during daylight time", () => {
  assert.equal(marketStatusFor("US", new Date("2026-06-08T13:29:00.000Z")), "pre");
  assert.equal(marketStatusFor("US", new Date("2026-06-08T13:30:00.000Z")), "open");
  assert.equal(marketStatusFor("US", new Date("2026-06-08T20:00:00.000Z")), "post");
  assert.equal(marketStatusFor("US", new Date("2026-06-09T00:00:00.000Z")), "closed");
});

test("US market status uses New York regular-session boundaries during standard time", () => {
  assert.equal(marketStatusFor("US", new Date("2026-01-05T14:29:00.000Z")), "pre");
  assert.equal(marketStatusFor("US", new Date("2026-01-05T14:30:00.000Z")), "open");
  assert.equal(marketStatusFor("US", new Date("2026-01-05T21:00:00.000Z")), "post");
  assert.equal(marketStatusFor("US", new Date("2026-01-06T01:00:00.000Z")), "closed");
});

test("US market status closes on New York weekends", () => {
  assert.equal(marketStatusFor("US", new Date("2026-06-07T14:00:00.000Z")), "closed");
});

test("HK market status uses HKEX pre-opening and regular-session boundaries", () => {
  assert.equal(marketStatusFor("HK", new Date("2026-06-09T00:59:00.000Z")), "closed");
  assert.equal(marketStatusFor("HK", new Date("2026-06-09T01:00:00.000Z")), "pre");
  assert.equal(marketStatusFor("HK", new Date("2026-06-09T01:29:00.000Z")), "pre");
  assert.equal(marketStatusFor("HK", new Date("2026-06-09T01:30:00.000Z")), "open");
  assert.equal(marketStatusFor("HK", new Date("2026-06-09T08:00:00.000Z")), "post");
  assert.equal(marketStatusFor("HK", new Date("2026-06-09T08:10:00.000Z")), "closed");
});

test("CN market status uses opening auction and continuous-session boundaries", () => {
  assert.equal(marketStatusFor("CN", new Date("2026-06-09T01:14:00.000Z")), "closed");
  assert.equal(marketStatusFor("CN", new Date("2026-06-09T01:15:00.000Z")), "pre");
  assert.equal(marketStatusFor("CN", new Date("2026-06-09T01:29:00.000Z")), "pre");
  assert.equal(marketStatusFor("CN", new Date("2026-06-09T01:30:00.000Z")), "open");
  assert.equal(marketStatusFor("CN", new Date("2026-06-09T03:30:00.000Z")), "closed");
  assert.equal(marketStatusFor("CN", new Date("2026-06-09T05:00:00.000Z")), "open");
  assert.equal(marketStatusFor("CN", new Date("2026-06-09T07:00:00.000Z")), "post");
  assert.equal(marketStatusFor("CN", new Date("2026-06-09T07:05:00.000Z")), "closed");
});

test("Sina quote uses US extended-hours fields during premarket when enabled", async (t) => {
  mockQuoteFetch(t, SINA_US_PREMARKET_BODY);
  const provider = new SinaProvider({
    now: () => new Date("2026-06-17T09:57:00.000Z"),
    useUsPremarketPnl: () => true,
  });

  const quote = await provider.fetchQuote(asset());

  assert.equal(quote.ok, true);
  assert.equal(quote.ok ? quote.data.latest_price : null, 733.56);
  assert.equal(quote.ok ? quote.data.previous_close : null, 729.86);
  assert.equal(quote.ok ? quote.data.pre_previous_close : null, 744);
  assert.equal(quote.ok ? quote.data.change_amount : null, 3.7);
  assert.equal(quote.ok ? quote.data.change_percent : null, 0.51);
  assert.equal(quote.ok ? quote.data.volume : null, 318107);
  assert.equal(quote.ok ? quote.data.market_status : null, "pre");
  assert.equal(quote.ok ? quote.data.quote_time : null, "2026-06-17T09:57:00.000Z");
});

test("Sina quote keeps US regular-session fields during premarket when disabled", async (t) => {
  mockQuoteFetch(t, SINA_US_PREMARKET_BODY);
  const provider = new SinaProvider({
    now: () => new Date("2026-06-17T09:57:00.000Z"),
    useUsPremarketPnl: () => false,
  });

  const quote = await provider.fetchQuote(asset());

  assert.equal(quote.ok, true);
  assert.equal(quote.ok ? quote.data.latest_price : null, 729.86);
  assert.equal(quote.ok ? quote.data.previous_close : null, 744);
  assert.equal(quote.ok ? quote.data.pre_previous_close : null, null);
  assert.equal(quote.ok ? quote.data.change_amount : null, -14.14);
  assert.equal(quote.ok ? quote.data.change_percent : null, -1.9);
  assert.equal(quote.ok ? quote.data.volume : null, 1000000);
  assert.equal(quote.ok ? quote.data.market_status : null, "pre");
  assert.equal(quote.ok ? quote.data.quote_time : null, "2026-06-16T20:00:00.000Z");
});

test("Sina quote keeps US closed-session pnl against the previous regular close", async (t) => {
  mockQuoteFetch(t, SINA_US_CLOSED_BODY);
  const provider = new SinaProvider({
    now: () => new Date("2026-06-17T06:30:00.000Z"),
    useUsPremarketPnl: () => true,
  });

  const quote = await provider.fetchQuote(asset());

  assert.equal(quote.ok, true);
  assert.equal(quote.ok ? quote.data.latest_price : null, 729.86);
  assert.equal(quote.ok ? quote.data.previous_close : null, 744);
  assert.equal(quote.ok ? quote.data.pre_previous_close : null, null);
  assert.equal(quote.ok ? quote.data.market_status : null, "closed");
  assert.equal(quote.ok ? quote.data.quote_time : null, "2026-06-16T20:00:00.000Z");
});
