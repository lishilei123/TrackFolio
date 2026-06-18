import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { Asset } from "../domain/types.js";
import { YahooProvider } from "./yahoo.js";

function asset(over: Partial<Asset> = {}): Asset {
  return {
    id: "a1",
    asset_type: "STOCK",
    market: "US",
    symbol: "MSFT",
    name: "Microsoft",
    currency: "USD",
    exchange: null,
    fund_type: null,
    quote_status: "ok",
    created_at: "",
    updated_at: "",
    ...over,
  };
}

function yahooChartResponse(meta: Record<string, unknown>, close: Array<number | null>) {
  return {
    chart: {
      result: [
        {
          meta,
          timestamp: [1780761600, 1780848000, 1780934400, 1781020800, 1781107200],
          indicators: {
            quote: [
              {
                open: [219, 206, 209, 208, null],
                high: [220, 207, 210, 209, null],
                low: [217, 204, 207, 207, null],
                close,
                volume: [100, 200, 300, 400, null],
              },
            ],
          },
        },
      ],
    },
  };
}

function mockFetch(t: TestContext, body: unknown | unknown[]): string[] {
  const urls: string[] = [];
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input) => {
    const responseBody = Array.isArray(body) ? body[Math.min(urls.length, body.length - 1)] : body;
    urls.push(String(input));
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return urls;
}

test("Yahoo quote uses the last completed daily close as previous_close when the latest bar is incomplete", async (t) => {
  const regularMarketTime = Date.parse("2026-06-10T20:00:00.000Z") / 1000;
  const urls = mockFetch(
    t,
    yahooChartResponse(
      {
        regularMarketPrice: 200.42,
        regularMarketTime,
        chartPreviousClose: 214.75,
        marketState: "PRE",
      },
      [218.66, 205.1, 208.64, 208.19, null],
    ),
  );

  const result = await new YahooProvider({
    now: () => new Date("2026-06-10T14:00:00.000Z"),
    useUsPremarketPnl: () => true,
  }).fetchQuote(asset());

  assert.ok(result.ok);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /range=5d/);
  assert.match(urls[0], /interval=1d/);
  assert.deepEqual(result.data, {
    latest_price: 200.42,
    previous_close: 208.19,
    pre_previous_close: 208.64,
    open: 208,
    high: 209,
    low: 207,
    volume: 400,
    change_amount: -7.77,
    change_percent: -3.73,
    market_status: "pre",
    quote_time: "2026-06-10T20:00:00.000Z",
  });
});

test("Yahoo quote treats a finite tail daily close as previous_close during premarket historical-only responses", async (t) => {
  mockFetch(
    t,
    yahooChartResponse(
      {
        regularMarketPrice: 200.42,
        regularMarketTime: Date.parse("2026-06-11T10:00:00.000Z") / 1000,
        chartPreviousClose: 214.75,
        marketState: "PRE",
      },
      [218.66, 205.1, 208.64, 208.19, 202.4],
    ),
  );

  const result = await new YahooProvider({
    now: () => new Date("2026-06-10T14:00:00.000Z"),
    useUsPremarketPnl: () => true,
  }).fetchQuote(asset());

  assert.ok(result.ok);
  assert.equal(result.data.previous_close, 202.4);
  assert.equal(result.data.pre_previous_close, 208.19);
  assert.equal(result.data.change_amount, -1.98);
  assert.equal(result.data.change_percent, -0.98);
  assert.equal(result.data.market_status, "pre");
});

test("Yahoo quote uses extended-hours price and time during premarket", async (t) => {
  mockFetch(
    t,
    yahooChartResponse(
      {
        regularMarketPrice: 200.42,
        regularMarketTime: Date.parse("2026-06-10T20:00:00.000Z") / 1000,
        preMarketPrice: 204.1,
        preMarketTime: Date.parse("2026-06-11T10:30:00.000Z") / 1000,
        chartPreviousClose: 214.75,
        marketState: "PRE",
      },
      [218.66, 205.1, 208.64, 208.19, 202.4],
    ),
  );

  const result = await new YahooProvider({
    now: () => new Date("2026-06-10T14:00:00.000Z"),
    useUsPremarketPnl: () => true,
  }).fetchQuote(asset());

  assert.ok(result.ok);
  assert.equal(result.data.latest_price, 204.1);
  assert.equal(result.data.previous_close, 202.4);
  assert.equal(result.data.change_amount, 1.7);
  assert.equal(result.data.change_percent, 0.84);
  assert.equal(result.data.market_status, "pre");
  assert.equal(result.data.quote_time, "2026-06-11T10:30:00.000Z");
});

test("Yahoo quote uses latest regular close against prior close when premarket is disabled", async (t) => {
  const urls = mockFetch(
    t,
    yahooChartResponse(
      {
        regularMarketPrice: 200.42,
        regularMarketTime: Date.parse("2026-06-10T20:00:00.000Z") / 1000,
        preMarketPrice: 204.1,
        preMarketTime: Date.parse("2026-06-11T10:30:00.000Z") / 1000,
        chartPreviousClose: 214.75,
        marketState: "PRE",
      },
      [218.66, 205.1, 208.64, 208.19, 202.4],
    ),
  );

  const result = await new YahooProvider({
    now: () => new Date("2026-06-10T14:00:00.000Z"),
    useUsPremarketPnl: () => false,
  }).fetchQuote(asset());

  assert.ok(result.ok);
  assert.equal(urls.length, 1);
  assert.equal(result.data.latest_price, 202.4);
  assert.equal(result.data.previous_close, 208.19);
  assert.equal(result.data.pre_previous_close, 208.64);
  assert.equal(result.data.change_amount, -5.79);
  assert.equal(result.data.change_percent, -2.78);
  assert.equal(result.data.market_status, "pre");
  assert.equal(result.data.quote_time, "2026-06-10T20:00:00.000Z");
});

test("Yahoo quote falls back to 1m extended-hours chart when daily meta lacks premarket fields", async (t) => {
  const urls = mockFetch(
    t,
    [
      yahooChartResponse(
        {
          regularMarketPrice: 200.42,
          regularMarketTime: Date.parse("2026-06-10T20:00:00.000Z") / 1000,
          chartPreviousClose: 214.75,
          marketState: null,
        },
        [218.66, 205.1, 208.64, 208.19, 202.4],
      ),
      yahooChartResponse(
        {
          regularMarketPrice: 200.42,
          regularMarketTime: Date.parse("2026-06-10T20:00:00.000Z") / 1000,
          chartPreviousClose: 202.4,
          marketState: null,
        },
        [null, 203.9, 204.12],
      ),
    ],
  );

  const result = await new YahooProvider({
    now: () => new Date("2026-06-10T12:00:00.000Z"),
    useUsPremarketPnl: () => true,
  }).fetchQuote(asset());

  assert.ok(result.ok);
  assert.equal(urls.length, 2);
  assert.match(urls[1], /interval=1m/);
  assert.match(urls[1], /includePrePost=true/);
  assert.equal(result.data.latest_price, 204.12);
  assert.equal(result.data.previous_close, 202.4);
  assert.equal(result.data.change_amount, 1.72);
  assert.equal(result.data.market_status, "pre");
});

test("Yahoo quote uses the prior daily close when the latest bar already has a close", async (t) => {
  mockFetch(
    t,
    yahooChartResponse(
      {
        regularMarketPrice: 202.4,
        regularMarketTime: Date.parse("2026-06-10T20:00:00.000Z") / 1000,
        chartPreviousClose: 214.75,
        marketState: "REGULAR",
      },
      [218.66, 205.1, 208.64, 208.19, 202.4],
    ),
  );

  const result = await new YahooProvider({ now: () => new Date("2026-06-10T14:00:00.000Z") }).fetchQuote(asset());

  assert.ok(result.ok);
  assert.equal(result.data.previous_close, 208.19);
  assert.equal(result.data.pre_previous_close, 208.64);
  assert.equal(result.data.change_amount, -5.79);
  assert.equal(result.data.change_percent, -2.78);
  assert.equal(result.data.market_status, "open");
});
