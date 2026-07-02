import assert from "node:assert/strict";
import { test } from "node:test";
import type { Asset, Position, QuoteSnapshot } from "../domain/types.js";
import type { DailyPnlRow } from "../repositories/dailyPnl.js";
import { __setExtendedHoursPnlForTest } from "./extendedHoursPnl.js";
import {
  __setCurrentSettlementDateForTest,
  __setCurrentSettlementTimezoneForTest,
  computeHolding,
  computeOverview,
  currentSettlementDate,
  previousSettlementDateForAsset,
} from "./pnl.js";

__setCurrentSettlementDateForTest("2026-06-10");

function withExtendedHoursPnl(settings: { premarket?: boolean; postmarket?: boolean }, fn: () => void): void {
  __setExtendedHoursPnlForTest(settings);
  try {
    fn();
  } finally {
    __setExtendedHoursPnlForTest({ premarket: null, postmarket: null });
  }
}

function stockAsset(over: Partial<Asset> = {}): Asset {
  return {
    id: "a1",
    asset_type: "STOCK",
    market: "CN",
    symbol: "600519",
    name: "贵州茅台",
    currency: "CNY",
    exchange: null,
    fund_type: null,
    quote_status: "ok",
    created_at: "",
    updated_at: "",
    ...over,
  };
}

function position(over: Partial<Position> = {}): Position {
  return {
    id: "p1",
    asset_id: "a1",
    quantity: 100,
    avg_cost: 100,
    total_fee: 10,
    opened_at: null,
    closed_at: null,
    tags: [],
    note: null,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

function quote(over: Partial<QuoteSnapshot> = {}): QuoteSnapshot {
  return {
    asset_id: "a1",
    latest_price: 110,
    latest_nav: null,
    previous_close: 105,
    pre_previous_close: 100,
    previous_nav: null,
    nav_date: null,
    open: 106,
    high: 112,
    low: 104,
    volume: 1000,
    change_amount: 5,
    change_percent: 4.76,
    market_status: "open",
    quote_time: `${currentSettlementDate()}T02:00:00.000Z`,
    provider: "mock",
    status: "ok",
    ...over,
  };
}

function addDays(date: string, n: number): string {
  const t = Date.parse(date + "T00:00:00.000Z");
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10);
}

function previousDate(): string {
  const d = new Date(Date.parse(`${currentSettlementDate()}T00:00:00.000Z`) - 86_400_000);
  return d.toISOString().slice(0, 10);
}

function dailyRow(over: Partial<DailyPnlRow> = {}): DailyPnlRow {
  return {
    date: "2026-06-04",
    asset_id: "a1",
    market: "CN",
    asset_type: "STOCK",
    quantity: 35,
    close_price: 109,
    nav: null,
    daily_pnl_amount: -910,
    total_pnl_amount: -910,
    currency: "CNY",
    is_estimated: 1,
    created_at: "",
    ...over,
  };
}

function pnlTx(side: "BUY" | "SELL", quantity: number, price: number, trade_time = currentSettlementDate()) {
  return { side, quantity, price, trade_time };
}

test("无今日结算快照时今日盈亏按实时行情 = (最新价 - 上一收盘价) * 数量", () => {
  const h = computeHolding(stockAsset(), position(), quote(), "CNY");
  // (110 - 105) * 100 = 500
  assert.equal(h.today_pnl.amount, 500);
  assert.equal(h.today_pnl.computable, true);
  // 500 / (105 * 100) = 4.7619%
  assert.ok(Math.abs((h.today_pnl.percent ?? 0) - 4.7619) < 0.001);
});

test("总览今日收益率分母包含零盈亏但有基准的持仓", () => {
  const gain = computeHolding(
    stockAsset({ id: "a1", symbol: "AAA" }),
    position({ asset_id: "a1", quantity: 100, avg_cost: 10, total_fee: 0 }),
    quote({ asset_id: "a1", latest_price: 11, previous_close: 10 }),
    "CNY",
  );
  const flat = computeHolding(
    stockAsset({ id: "a2", symbol: "BBB" }),
    position({ id: "p2", asset_id: "a2", quantity: 100, avg_cost: 10, total_fee: 0 }),
    quote({ asset_id: "a2", latest_price: 10, previous_close: 10 }),
    "CNY",
  );

  const ov = computeOverview([gain, flat], "CNY");
  assert.equal(ov.today_pnl, 100);
  assert.equal(ov.today_pnl_percent, 5);
});

test("今日加仓时：老仓按昨收、新买按成交价计算今日盈亏和比例", () => {
  const h = computeHolding(
    stockAsset(),
    position({ quantity: 200, avg_cost: 15, total_fee: 0 }),
    quote({ latest_price: 18, previous_close: 12 }),
    "CNY",
    null,
    null,
    [pnlTx("BUY", 100, 20)],
  );

  // 老仓 (18 - 12) * 100 = 600；新买 (18 - 20) * 100 = -200。
  assert.equal(h.today_pnl.amount, 400);
  assert.equal(h.today_pnl.basis, 3200);
  assert.equal(h.today_pnl.percent, 12.5);

  const ov = computeOverview([h], "CNY");
  assert.equal(ov.today_pnl, 400);
  assert.equal(ov.today_pnl_percent, 12.5);
});

test("今日减仓时：卖出部分确认日内价格变动，剩余仓位继续按最新价浮动", () => {
  const h = computeHolding(
    stockAsset(),
    position({ quantity: 150, avg_cost: 10, total_fee: 0 }),
    quote({ latest_price: 14, previous_close: 12 }),
    "CNY",
    null,
    null,
    [pnlTx("SELL", 50, 30)],
  );

  // 卖出 (30 - 12) * 50 = 900；剩余 (14 - 12) * 150 = 300。
  assert.equal(h.today_pnl.amount, 1200);
  assert.equal(h.today_pnl.basis, 2400);
  assert.equal(h.today_pnl.percent, 50);
});

test("DailyPnL 减仓快照收益率分母复用交易感知口径", () => {
  const h = computeHolding(
    stockAsset(),
    position({ quantity: 150, avg_cost: 10, total_fee: 0 }),
    quote({ previous_close: 14, pre_previous_close: 12 }),
    "CNY",
    null,
    dailyRow({ quantity: 150, close_price: 14, daily_pnl_amount: 1200, date: previousDate() }),
    [pnlTx("SELL", 50, 30, `${previousDate()}T10:00:00.000Z`)],
  );

  // 旧倒推 close * quantity - amount = 14 * 150 - 1200 = 900；减仓日应按昨收 12 的期初 200 股作分母。
  assert.equal(h.yesterday_pnl.amount, 1200);
  assert.equal(h.yesterday_pnl.basis, 2400);
  assert.equal(h.yesterday_pnl.percent, 50);
});

test("港股昨日休市时昨日盈亏按日历昨日归零，不回退上一交易日", () => {
  __setCurrentSettlementDateForTest("2026-07-02");
  try {
    const hk = stockAsset({ market: "HK", currency: "HKD", symbol: "00700" });
    assert.equal(previousSettlementDateForAsset(hk), "2026-07-01");

    const h = computeHolding(
      hk,
      position({ quantity: 100, avg_cost: 90, total_fee: 0 }),
      quote({
        latest_price: 110,
        previous_close: 100,
        pre_previous_close: 95,
        market_status: "open",
        quote_time: "2026-07-02T02:00:00.000Z",
      }),
      "HKD",
      null,
      dailyRow({
        date: "2026-07-01",
        market: "HK",
        currency: "HKD",
        quantity: 90,
        close_price: 100,
        daily_pnl_amount: 450,
        total_pnl_amount: 900,
        is_estimated: 0,
      }),
    );

    assert.equal(h.yesterday_pnl.amount, 0);
    assert.equal(h.yesterday_pnl.percent, 0);
    assert.equal(h.yesterday_pnl.estimated, false);
  } finally {
    __setCurrentSettlementDateForTest("2026-06-10");
  }
});

test("非交易时段有今日结算快照时：今日盈亏使用 DailyPnL", () => {
  const h = computeHolding(
    stockAsset(),
    position({ quantity: 35, avg_cost: 135 }),
    quote({ previous_close: 109, pre_previous_close: 132, market_status: "closed" }),
    "CNY",
    dailyRow({ quantity: 35, close_price: 109, daily_pnl_amount: -910, date: currentSettlementDate() }),
  );
  assert.equal(h.today_pnl.amount, -910);
  assert.equal(h.today_pnl.computable, true);
});

test("美股同一结算日新一场开盘时：今日盈亏等于已结算快照 A 加实时盈亏 B", () => {
  // 北京时间凌晨收盘快照 A 落到当前结算日；当晚新一场开盘后，今日盈亏应展示 A+B。
  const h = computeHolding(
    stockAsset({ market: "US", currency: "USD", symbol: "AAPL" }),
    position({ quantity: 100, avg_cost: 90 }),
    quote({ latest_price: 110, previous_close: 105, market_status: "open" }),
    "USD",
    dailyRow({
      quantity: 100,
      close_price: 105,
      daily_pnl_amount: 300,
      date: currentSettlementDate(),
      currency: "USD",
    }),
  );
  // A=300；B=(110 - 105) * 100 = 500；今日 = 800。
  assert.equal(h.today_pnl.amount, 800);
  assert.equal(h.today_pnl.basis, 10200);
  assert.ok(Math.abs((h.today_pnl.percent ?? 0) - 7.8431) < 0.001);

  const ov = computeOverview([h], "USD");
  assert.equal(ov.today_pnl, 800);
  assert.equal(ov.today_pnl_percent, 7.84);
});

test("美股同一结算日已有收盘快照时：盘前行情继续并入今日盈亏", () => {
  const h = computeHolding(
    stockAsset({ market: "US", currency: "USD", symbol: "AAPL" }),
    position({ quantity: 100, avg_cost: 90 }),
    quote({
      latest_price: 103,
      previous_close: 105,
      pre_previous_close: 100,
      market_status: "pre",
      quote_time: `${currentSettlementDate()}T08:32:00.000Z`,
    }),
    "USD",
    dailyRow({
      quantity: 100,
      close_price: 105,
      daily_pnl_amount: 500,
      date: currentSettlementDate(),
      currency: "USD",
    }),
  );

  // A=500；盘前 B=(103 - 105) * 100 = -200；今日 = 300。
  assert.equal(h.today_pnl.amount, 300);
  assert.equal(h.today_pnl.basis, 10000);
  assert.equal(h.today_pnl.computable, true);
  assert.notEqual(h.today_pnl.amount, 500);
});

test("美股同一结算日收盘价有数据源尾差时：盘前仍合并快照", () => {
  const h = computeHolding(
    stockAsset({ market: "US", currency: "USD", symbol: "QQQ" }),
    position({ quantity: 2, avg_cost: 734.5 }),
    quote({
      latest_price: 724.36,
      previous_close: 724.0800170898438,
      pre_previous_close: 706.52,
      market_status: "pre",
      quote_time: `${currentSettlementDate()}T09:36:06.000Z`,
    }),
    "USD",
    dailyRow({
      quantity: 2,
      close_price: 724.08,
      daily_pnl_amount: 35.12000000000012,
      date: currentSettlementDate(),
      currency: "USD",
    }),
  );

  assert.ok(Math.abs((h.today_pnl.amount ?? 0) - 35.67996582031262) < 1e-6);
  assert.notEqual(h.today_pnl.amount, 0.5599658203123984);
});

test("美股同一结算日另有新买入时：只把新增本金追加到盈亏率分母", () => {
  const h = computeHolding(
    stockAsset({ market: "US", currency: "USD", symbol: "AAPL" }),
    position({ quantity: 200, avg_cost: 100 }),
    quote({ latest_price: 110, previous_close: 105, market_status: "open" }),
    "USD",
    dailyRow({
      quantity: 100,
      close_price: 105,
      daily_pnl_amount: 300,
      date: currentSettlementDate(),
      currency: "USD",
    }),
    null,
    [pnlTx("BUY", 100, 108)],
  );

  assert.equal(h.today_pnl.amount, 1000);
  assert.equal(h.today_pnl.basis, 21000);
  assert.ok(Math.abs((h.today_pnl.percent ?? 0) - 4.7619) < 0.001);

  const ov = computeOverview([h], "USD");
  assert.equal(ov.today_pnl, 1000);
  assert.equal(ov.today_pnl_percent, 4.76);
});

test("美股过了结算时区 24 点后：今日只算新一场实时 B，昨日读上一结算日快照 A", () => {
  __setCurrentSettlementDateForTest("2026-06-11");
  try {
    const h = computeHolding(
      stockAsset({ market: "US", currency: "USD", symbol: "AAPL" }),
      position({ quantity: 100, avg_cost: 90 }),
      quote({
        latest_price: 110,
        previous_close: 105,
        market_status: "open",
        quote_time: "2026-06-10T16:30:00.000Z", // Asia/Shanghai = 2026-06-11 00:30
      }),
      "USD",
      null,
      dailyRow({
        quantity: 100,
        close_price: 105,
        daily_pnl_amount: 300,
        date: previousDate(),
        currency: "USD",
      }),
    );

    assert.equal(h.today_pnl.amount, 500);
    assert.equal(h.yesterday_pnl.amount, 300);
  } finally {
    __setCurrentSettlementDateForTest("2026-06-10");
  }
});

test("美股盘中今日交易按行情交易日匹配，而不是按收盘结算日错位", () => {
  const h = computeHolding(
    stockAsset({ market: "US", currency: "USD", symbol: "AAPL" }),
    position({ quantity: 2, avg_cost: 102.5, total_fee: 0 }),
    quote({
      latest_price: 110,
      previous_close: 100,
      market_status: "open",
      quote_time: `${currentSettlementDate()}T14:00:00.000Z`,
    }),
    "USD",
    null,
    null,
    [pnlTx("BUY", 1, 105, currentSettlementDate())],
  );

  // 隔夜 1 股 (110 - 100) + 今日买入 1 股 (110 - 105)，不是全仓 (110 - 100) * 2。
  assert.equal(h.today_pnl.amount, 15);
  assert.notEqual(h.today_pnl.amount, 20);
});

test("US premarket quote uses latest against previous close for today's pnl", () => {
  const h = computeHolding(
    stockAsset({ market: "US", currency: "USD", symbol: "AAPL" }),
    position({ quantity: 100, avg_cost: 90 }),
    quote({
      latest_price: 110,
      previous_close: 105,
      market_status: "pre",
      quote_time: "2026-06-10T12:00:00.000Z",
    }),
    "USD",
  );

  assert.equal(h.today_pnl.amount, 500);
  assert.equal(h.today_pnl.computable, true);
});

test("US regular close quote uses close-to-close pnl during Beijing settlement day when premarket is disabled upstream", () => {
  const h = computeHolding(
    stockAsset({ market: "US", currency: "USD", symbol: "AAPL" }),
    position({ quantity: 100, avg_cost: 90 }),
    quote({
      latest_price: 105,
      previous_close: 100,
      pre_previous_close: 95,
      market_status: "pre",
      quote_time: "2026-06-10T12:00:00.000Z",
    }),
    "USD",
  );

  assert.equal(h.today_pnl.amount, 500);
  assert.equal(h.today_pnl.computable, true);
});

test("US postmarket quote uses latest against previous close for today's pnl", () => {
  const h = computeHolding(
    stockAsset({ market: "US", currency: "USD", symbol: "AAPL" }),
    position({ quantity: 100, avg_cost: 90 }),
    quote({
      latest_price: 205.5,
      previous_close: 208.19,
      market_status: "post",
      quote_time: "2026-06-10T21:30:00.000Z",
    }),
    "USD",
  );

  assert.equal(h.today_pnl.amount, -269);
  assert.equal(h.today_pnl.computable, true);
});

test("US regular close quote uses close-to-close pnl during postmarket when postmarket is disabled upstream", () => {
  const h = computeHolding(
    stockAsset({ market: "US", currency: "USD", symbol: "AAPL" }),
    position({ quantity: 100, avg_cost: 90 }),
    quote({
      latest_price: 202.4,
      previous_close: 208.19,
      pre_previous_close: 205.1,
      market_status: "post",
      quote_time: "2026-06-10T21:30:00.000Z",
    }),
    "USD",
  );

  assert.equal(h.today_pnl.amount, -579);
  assert.equal(h.today_pnl.computable, true);
});

test("US Monday evening in Shanghai counts live intraday quote even without a same-day settlement close", () => {
  __setCurrentSettlementDateForTest("2026-06-15"); // Monday in Asia/Shanghai.
  try {
    const h = computeHolding(
      stockAsset({ market: "US", currency: "USD", symbol: "AAPL" }),
      position({ quantity: 100, avg_cost: 90 }),
      quote({
        latest_price: 110,
        previous_close: 105,
        market_status: "open",
        quote_time: "2026-06-15T14:00:00.000Z", // 22:00 Asia/Shanghai, Monday US regular session.
      }),
      "USD",
    );

    assert.equal(h.today_pnl.amount, 500);
    assert.equal(h.today_pnl.computable, true);
  } finally {
    __setCurrentSettlementDateForTest("2026-06-10");
  }
});

test("US Monday in Shanghai still ignores stale closed quote from the prior session", () => {
  __setCurrentSettlementDateForTest("2026-06-15"); // Monday in Asia/Shanghai.
  try {
    const h = computeHolding(
      stockAsset({ market: "US", currency: "USD", symbol: "AAPL" }),
      position({ quantity: 100, avg_cost: 90 }),
      quote({
        latest_price: 110,
        previous_close: 105,
        market_status: "closed",
        quote_time: "2026-06-13T02:00:00.000Z", // Saturday Shanghai time, prior Friday US session.
      }),
      "USD",
    );

    assert.equal(h.today_pnl.amount, 0);
    assert.equal(h.today_pnl.computable, true);
  } finally {
    __setCurrentSettlementDateForTest("2026-06-10");
  }
});

test("总持仓盈亏 = (最新价 - 成本) * 数量 - 费用", () => {
  const h = computeHolding(stockAsset(), position(), quote(), "CNY");
  // (110 - 100) * 100 - 10 = 990
  assert.equal(h.total_pnl.amount, 990);
  // 990 / (100*100 + 10) = 9.8901%
  assert.ok(Math.abs((h.total_pnl.percent ?? 0) - 9.8901) < 0.001);
});

test("休市日/隔夜旧行情不计入今日盈亏（行情停在更早交易日）", () => {
  const h = computeHolding(
    stockAsset({ market: "HK", currency: "HKD", symbol: "00700" }),
    position(),
    quote({ market_status: "closed", quote_time: `${previousDate()}T02:00:00.000Z` }),
    "HKD",
  );
  assert.equal(h.today_pnl.amount, 0);
  assert.equal(h.today_pnl.percent, 0);
  assert.equal(h.today_pnl.computable, true);
});

test("港股盘前默认使用当日最新价计算今日盈亏", () => {
  const h = computeHolding(
    stockAsset({ market: "HK", currency: "HKD", symbol: "00700" }),
    position({ quantity: 100 }),
    quote({
      latest_price: 109,
      previous_close: 132.5,
      pre_previous_close: 146.2,
      market_status: "pre",
      quote_time: `${currentSettlementDate()}T01:10:00.000Z`,
    }),
    "HKD",
    dailyRow({
      market: "HK",
      currency: "HKD",
      date: currentSettlementDate(),
      daily_pnl_amount: -2350,
    }),
  );
  assert.equal(h.today_pnl.amount, -2350);
  assert.ok(Math.abs((h.today_pnl.percent ?? 0) - -17.7358) < 0.001);
  assert.equal(h.today_pnl.computable, true);
});

test("A股/港股盘前默认按北京时间结算计入当日最新价", () => {
  withExtendedHoursPnl({ premarket: false }, () => {
    const cn = computeHolding(
      stockAsset({ market: "CN", currency: "CNY", symbol: "600519" }),
      position({ quantity: 100 }),
      quote({
        latest_price: 109,
        previous_close: 100,
        market_status: "pre",
        quote_time: `${currentSettlementDate()}T01:20:00.000Z`,
      }),
      "CNY",
    );
    const hk = computeHolding(
      stockAsset({ market: "HK", currency: "HKD", symbol: "00700" }),
      position({ quantity: 100 }),
      quote({
        latest_price: 109,
        previous_close: 100,
        market_status: "pre",
        quote_time: `${currentSettlementDate()}T01:10:00.000Z`,
      }),
      "HKD",
    );

    assert.equal(cn.today_pnl.amount, 900);
    assert.equal(cn.today_pnl.computable, true);
    assert.equal(hk.today_pnl.amount, 900);
    assert.equal(hk.today_pnl.computable, true);
  });
});

test("港股开市前 closed 行情即使时间戳为今天也不计入今日盈亏", () => {
  const h = computeHolding(
    stockAsset({ market: "HK", currency: "HKD", symbol: "00700" }),
    position({ quantity: 100 }),
    quote({
      latest_price: 109,
      previous_close: 132.5,
      pre_previous_close: 146.2,
      market_status: "closed",
      quote_time: `${currentSettlementDate()}T00:30:00.000Z`,
    }),
    "HKD",
  );
  assert.equal(h.today_pnl.amount, 0);
  assert.equal(h.today_pnl.percent, 0);
  assert.equal(h.today_pnl.computable, true);
});

test("港股收盘后当日行情仍可实时计算今日盈亏", () => {
  const h = computeHolding(
    stockAsset({ market: "HK", currency: "HKD", symbol: "00700" }),
    position({ quantity: 100 }),
    quote({
      latest_price: 110,
      previous_close: 105,
      market_status: "closed",
      quote_time: `${currentSettlementDate()}T08:30:00.000Z`,
    }),
    "HKD",
  );
  assert.equal(h.today_pnl.amount, 500);
  assert.ok(Math.abs((h.today_pnl.percent ?? 0) - 4.7619) < 0.001);
});

test("A股/港股盘后行情默认不归零今日盈亏", () => {
  const cn = computeHolding(
    stockAsset({ market: "CN", currency: "CNY", symbol: "600519" }),
    position({ quantity: 100 }),
    quote({
      latest_price: 110,
      previous_close: 105,
      market_status: "post",
      quote_time: `${currentSettlementDate()}T07:02:00.000Z`,
    }),
    "CNY",
  );
  const hk = computeHolding(
    stockAsset({ market: "HK", currency: "HKD", symbol: "00700" }),
    position({ quantity: 100 }),
    quote({
      latest_price: 110,
      previous_close: 105,
      market_status: "post",
      quote_time: `${currentSettlementDate()}T08:05:00.000Z`,
    }),
    "HKD",
  );

  assert.equal(cn.today_pnl.amount, 500);
  assert.equal(cn.today_pnl.computable, true);
  assert.equal(hk.today_pnl.amount, 500);
  assert.equal(hk.today_pnl.computable, true);
});

test("A股/港股盘后不受美股盘后开关影响，默认使用盘后实时价", () => {
  withExtendedHoursPnl({ postmarket: true }, () => {
    const cn = computeHolding(
      stockAsset({ market: "CN", currency: "CNY", symbol: "600519" }),
      position({ quantity: 100 }),
      quote({
        latest_price: 110,
        previous_close: 105,
        market_status: "post",
        quote_time: `${currentSettlementDate()}T07:02:00.000Z`,
      }),
      "CNY",
    );
    const hk = computeHolding(
      stockAsset({ market: "HK", currency: "HKD", symbol: "00700" }),
      position({ quantity: 100 }),
      quote({
        latest_price: 110,
        previous_close: 105,
        market_status: "post",
        quote_time: `${currentSettlementDate()}T08:05:00.000Z`,
      }),
      "HKD",
    );

    assert.equal(cn.today_pnl.amount, 500);
    assert.equal(cn.today_pnl.computable, true);
    assert.equal(hk.today_pnl.amount, 500);
    assert.equal(hk.today_pnl.computable, true);
  });
});

test("A股盘前默认使用当日最新价计算今日盈亏", () => {
  const h = computeHolding(
    stockAsset({ market: "CN", currency: "CNY", symbol: "600519" }),
    position({ quantity: 100 }),
    quote({
      latest_price: 109,
      previous_close: 132.5,
      pre_previous_close: 146.2,
      market_status: "pre",
      quote_time: `${currentSettlementDate()}T01:20:00.000Z`,
    }),
    "CNY",
    dailyRow({
      market: "CN",
      currency: "CNY",
      date: currentSettlementDate(),
      daily_pnl_amount: -2350,
    }),
  );
  assert.equal(h.today_pnl.amount, -2350);
  assert.ok(Math.abs((h.today_pnl.percent ?? 0) - -17.7358) < 0.001);
  assert.equal(h.today_pnl.computable, true);
});

test("A股/港股盘前默认按美东结算时区计入对应结算日涨跌", () => {
  __setCurrentSettlementDateForTest("2026-06-16");
  __setCurrentSettlementTimezoneForTest("America/New_York");
  try {
    withExtendedHoursPnl({ premarket: false }, () => {
      const cn = computeHolding(
        stockAsset({ market: "CN", currency: "CNY", symbol: "600519" }),
        position({ quantity: 100 }),
        quote({
          latest_price: 109,
          previous_close: 100,
          market_status: "pre",
          quote_time: "2026-06-17T01:20:00.000Z", // 2026-06-16 21:20 America/New_York, 2026-06-17 09:20 Shanghai.
        }),
        "CNY",
      );
      const hk = computeHolding(
        stockAsset({ market: "HK", currency: "HKD", symbol: "00700" }),
        position({ quantity: 100 }),
        quote({
          latest_price: 109,
          previous_close: 100,
          market_status: "pre",
          quote_time: "2026-06-17T01:10:00.000Z", // 2026-06-16 21:10 America/New_York, 2026-06-17 09:10 Hong Kong.
        }),
        "HKD",
      );

      assert.equal(cn.today_pnl.amount, 900);
      assert.equal(cn.today_pnl.computable, true);
      assert.equal(hk.today_pnl.amount, 900);
      assert.equal(hk.today_pnl.computable, true);
    });
  } finally {
    __setCurrentSettlementTimezoneForTest(null);
    __setCurrentSettlementDateForTest("2026-06-10");
  }
});

test("A股开市前 closed 行情即使时间戳为今天也不计入今日盈亏", () => {
  const h = computeHolding(
    stockAsset({ market: "CN", currency: "CNY", symbol: "600519" }),
    position({ quantity: 100 }),
    quote({
      latest_price: 109,
      previous_close: 132.5,
      pre_previous_close: 146.2,
      market_status: "closed",
      quote_time: `${currentSettlementDate()}T01:00:00.000Z`,
    }),
    "CNY",
  );
  assert.equal(h.today_pnl.amount, 0);
  assert.equal(h.today_pnl.percent, 0);
  assert.equal(h.today_pnl.computable, true);
});

test("HK stale quote still uses yesterday DailyPnL snapshot", () => {
  __setCurrentSettlementDateForTest("2026-06-11"); // 昨日 2026-06-10；是否休市由 quote_time 是否覆盖判断
  try {
    const h = computeHolding(
      stockAsset({ market: "HK", currency: "HKD", symbol: "07709" }),
      position({ quantity: 35, avg_cost: 135, total_fee: 18.61 }),
      quote({
        latest_price: 109,
        previous_close: 132.5,
        pre_previous_close: 146.2,
        market_status: "closed",
        quote_time: `${addDays(previousDate(), -1)}T08:09:16.000Z`,
      }),
      "HKD",
      null,
      dailyRow({
        market: "HK",
        currency: "HKD",
        date: previousDate(),
        quantity: 35,
        close_price: 109,
        daily_pnl_amount: 875,
      }),
    );
    assert.equal(h.yesterday_pnl.amount, 875);
    assert.equal(h.yesterday_pnl.computable, true);
  } finally {
    __setCurrentSettlementDateForTest("2026-06-10");
  }
});

test("CN yesterday DailyPnL snapshot is included in overview even when quote is stale", () => {
  __setCurrentSettlementDateForTest("2026-06-11");
  try {
    const h = computeHolding(
      stockAsset({ market: "CN", currency: "CNY", symbol: "600519" }),
      position({ quantity: 35, avg_cost: 135, total_fee: 18.61 }),
      quote({
        latest_price: 109,
        previous_close: 132.5,
        pre_previous_close: 146.2,
        market_status: "closed",
        quote_time: `${addDays(previousDate(), -1)}T07:09:16.000Z`,
      }),
      "CNY",
      null,
      dailyRow({
        market: "CN",
        currency: "CNY",
        date: previousDate(),
        quantity: 35,
        close_price: 109,
        daily_pnl_amount: -910,
      }),
    );

    const ov = computeOverview([h], "CNY");
    assert.equal(ov.yesterday_pnl, -910);
  } finally {
    __setCurrentSettlementDateForTest("2026-06-10");
  }
});

test("已收盘、当日收盘行情、快照未生成时：今日盈亏按 (收盘价 - 上一收盘) * 数量 实时计算", () => {
  // 美股一场收于次日北京凌晨，落在「当前结算日」；盘后到快照生成前不应归零。
  const h = computeHolding(
    stockAsset({ market: "US", currency: "USD", symbol: "AAPL" }),
    position({ quantity: 100, avg_cost: 90 }),
    quote({
      latest_price: 110,
      previous_close: 105,
      market_status: "closed",
      quote_time: `${currentSettlementDate()}T02:00:00.000Z`,
    }),
    "USD",
  );
  // (110 - 105) * 100 = 500
  assert.equal(h.today_pnl.amount, 500);
  assert.ok(Math.abs((h.today_pnl.percent ?? 0) - 4.7619) < 0.001);
});

test("美股已收盘、本场落在当前结算日、但今日快照被跨日重复净成 0：仍按实时行情计算", () => {
  // 美股本场收于次日北京凌晨，会与历史重算（按美股自然日）的快照同日重复，致今日快照当日盈亏被累计差值净成 0。
  // 此时不能采用该 0 快照，应回到实时 (最新价 - 上一收盘) * 数量。
  const h = computeHolding(
    stockAsset({ market: "US", currency: "USD", symbol: "QQQ" }),
    position({ quantity: 2, avg_cost: 733.5 }),
    quote({
      latest_price: 705.06,
      previous_close: 740.61,
      market_status: "closed",
      quote_time: `${currentSettlementDate()}T02:00:00.000Z`,
    }),
    "USD",
    dailyRow({ quantity: 2, close_price: 705.06, daily_pnl_amount: 0, date: currentSettlementDate(), currency: "USD" }),
  );
  // (705.06 - 740.61) * 2 = -71.10，而非被净成的 0
  assert.ok(Math.abs((h.today_pnl.amount ?? 0) - -71.1) < 1e-6);
  assert.notEqual(h.today_pnl.amount, 0);
  assert.equal(h.today_pnl.computable, true);
});

test("已收盘但行情停在更早交易日且无快照：今日盈亏记 0，不把过往涨跌算成今日", () => {
  const h = computeHolding(
    stockAsset({ market: "US", currency: "USD", symbol: "AAPL" }),
    position(),
    quote({ market_status: "closed", quote_time: `${previousDate()}T02:00:00.000Z` }),
    "USD",
  );
  assert.equal(h.today_pnl.amount, 0);
});

test("weekend calendar yesterday does not backfill previous trading day pnl", () => {
  __setCurrentSettlementDateForTest("2026-06-08"); // Monday; previous calendar day is Sunday.
  try {
    assert.equal(previousDate(), "2026-06-07");
    const h = computeHolding(
      stockAsset(),
      position(),
      quote({
        latest_price: 111,
        previous_close: 105,
        pre_previous_close: 100,
        market_status: "open",
        quote_time: `${currentSettlementDate()}T02:00:00.000Z`,
      }),
      "CNY",
      null,
      dailyRow({
        date: previousDate(),
        daily_pnl_amount: 999,
        close_price: 105,
      }),
    );
    assert.equal(h.yesterday_pnl.amount, 0);
    assert.equal(h.yesterday_pnl.percent, 0);
    assert.equal(h.yesterday_pnl.estimated, false);
  } finally {
    __setCurrentSettlementDateForTest("2026-06-10");
  }
});

test("美股没有对应北京昨日结算日时，不用行情链估算昨日盈亏", () => {
  __setCurrentSettlementDateForTest("2026-06-09"); // Tuesday Beijing; previous calendar day is Monday.
  try {
    assert.equal(previousDate(), "2026-06-08");
    const h = computeHolding(
      stockAsset({ market: "US", currency: "USD", symbol: "QQQ" }),
      position({ quantity: 2, avg_cost: 733.5 }),
      quote({
        latest_price: 721.76,
        previous_close: 705.06,
        pre_previous_close: 740.61,
        market_status: "open",
        quote_time: `${currentSettlementDate()}T02:00:00.000Z`,
      }),
      "USD",
    );
    assert.equal(h.yesterday_pnl.amount, 0);
    assert.equal(h.yesterday_pnl.percent, 0);
    assert.notEqual(h.yesterday_pnl.amount, (705.06 - 740.61) * 2);
  } finally {
    __setCurrentSettlementDateForTest("2026-06-10");
  }
});

test("昨日盈亏使用 昨日收盘 与 前一交易日收盘，标记为估算", () => {
  const h = computeHolding(stockAsset(), position(), quote(), "CNY");
  // (105 - 100) * 100 = 500
  assert.equal(h.yesterday_pnl.amount, 500);
  assert.equal(h.yesterday_pnl.estimated, true);
});

test("有历史快照时：昨日盈亏优先使用 DailyPnL，避免昨日新增按当前数量倒推", () => {
  const h = computeHolding(
    stockAsset(),
    position({ quantity: 35, avg_cost: 135 }),
    quote({ previous_close: 109, pre_previous_close: 132 }),
    "CNY",
    dailyRow({ quantity: 35, close_price: 109, daily_pnl_amount: -910, date: previousDate() }),
  );
  assert.equal(h.yesterday_pnl.amount, -910);
  assert.equal(h.yesterday_pnl.estimated, true);
  assert.notEqual(h.yesterday_pnl.amount, (109 - 132) * 35);
});

test("昨日新建仓且有历史快照时：昨日盈亏仍优先使用 DailyPnL", () => {
  const h = computeHolding(
    stockAsset(),
    position({ quantity: 35, avg_cost: 135, total_fee: 18.61, opened_at: previousDate() }),
    quote({ previous_close: 109, pre_previous_close: 132 }),
    "CNY",
    null,
    dailyRow({ quantity: 35, close_price: 109, daily_pnl_amount: -251.9, date: previousDate() }),
  );
  assert.equal(h.yesterday_pnl.amount, -251.9);
  assert.notEqual(h.yesterday_pnl.amount, (109 - 135) * 35 - 18.61);
});

test("美股昨日盈亏优先读对齐后的 DailyPnL 快照（历史已统一到北京结算日，不再按行情链特判）", () => {
  const h = computeHolding(
    stockAsset({ market: "US", currency: "USD", symbol: "QQQ" }),
    position({ quantity: 2, avg_cost: 733.5 }),
    quote({ previous_close: 740.61, pre_previous_close: 744.21 }),
    "USD",
    dailyRow({ quantity: 2, close_price: 724.46, daily_pnl_amount: -32.3, date: previousDate(), currency: "USD" }),
  );
  // 用快照口径 -32.3，而非已移除的美股专用分支 (prevClose-prePrevClose)*qty = -7.2
  assert.equal(h.yesterday_pnl.amount, -32.3);
  assert.notEqual(h.yesterday_pnl.amount, -7.2);
});

test("昨日新增但缺少 DailyPnL 快照时：昨日盈亏按昨日收盘与买入均价计算", () => {
  const h = computeHolding(
    stockAsset(),
    position({ quantity: 35, avg_cost: 135, total_fee: 18.61, opened_at: previousDate() }),
    quote({ previous_close: 132.5, pre_previous_close: 146.2 }),
    "CNY",
  );
  assert.equal(h.yesterday_pnl.amount, -106.11);
  assert.notEqual(h.yesterday_pnl.amount, (132.5 - 146.2) * 35);
});

test("交易日缺少上一收盘价且无今日快照时今日盈亏不可计算", () => {
  const h = computeHolding(stockAsset(), position(), quote({ previous_close: null }), "CNY");
  assert.equal(h.today_pnl.computable, false);
  assert.ok(h.today_pnl.reason);
});

test("场外基金按净值计算，昨日盈亏不可计算", () => {
  const fund = stockAsset({ asset_type: "FUND", fund_type: "otc", symbol: "000001" });
  const q = quote({ latest_price: null, latest_nav: 2.1, previous_nav: 2.0, previous_close: null });
  const h = computeHolding(fund, position({ quantity: 1000, avg_cost: 1.8 }), q, "CNY");
  assert.equal(h.is_nav_based, true);
  // (2.1 - 2.0) * 1000 = 100
  assert.ok(Math.abs((h.today_pnl.amount ?? 0) - 100) < 1e-6);
  assert.equal(h.yesterday_pnl.computable, false);
});

test("总览昨日盈亏计入当天清仓（昨日仍持有）资产的快照，但不影响市值/今日/总盈亏", () => {
  __setCurrentSettlementDateForTest("2026-06-11");
  try {
    const active = computeHolding(
      stockAsset({ id: "a1", symbol: "AAA" }),
      position({ id: "p1", asset_id: "a1", quantity: 100, avg_cost: 10, total_fee: 0 }),
      quote({ asset_id: "a1", latest_price: 11, previous_close: 10, pre_previous_close: 10 }),
      "CNY",
      null,
      dailyRow({ asset_id: "a1", quantity: 100, close_price: 10, daily_pnl_amount: 200, date: previousDate() }),
    );
    // 当天清仓资产：数量已归零，但昨日快照仍在（昨日持有 50 股，赚 300）
    const archived = computeHolding(
      stockAsset({ id: "a2", symbol: "BBB" }),
      position({ id: "p2", asset_id: "a2", quantity: 0, avg_cost: 10, total_fee: 5, closed_at: currentSettlementDate() }),
      quote({ asset_id: "a2", latest_price: 12, previous_close: 12 }),
      "CNY",
      null,
      dailyRow({ asset_id: "a2", quantity: 50, close_price: 12, daily_pnl_amount: 300, date: previousDate() }),
    );
    assert.equal(archived.yesterday_pnl.amount, 300);

    // 不传 archived：昨日只含活跃 200
    assert.equal(computeOverview([active], "CNY").yesterday_pnl, 200);

    // 传 archived：昨日含清仓资产 → 500；市值/总盈亏仅来自活跃持仓，不受清仓资产影响
    const ov = computeOverview([active], "CNY", [archived]);
    assert.equal(ov.yesterday_pnl, 500);
    assert.equal(ov.total_market_value, 1100); // 仅活跃 11 * 100
    assert.equal(ov.total_pnl, 100); // 仅活跃 (11 - 10) * 100
  } finally {
    __setCurrentSettlementDateForTest("2026-06-10");
  }
});

test("总览今日盈亏计入当天清仓资产的已实现盈亏，但不影响市值/总盈亏", () => {
  const active = computeHolding(
    stockAsset({ id: "a1", symbol: "AAA" }),
    position({ id: "p1", asset_id: "a1", quantity: 100, avg_cost: 10, total_fee: 0 }),
    quote({ asset_id: "a1", latest_price: 11, previous_close: 10 }),
    "CNY",
  );
  // 当天清仓：今日卖出 100 @ 12（昨收 10）→ 当日已实现 (12 - 10) * 100 = 200
  const archived = computeHolding(
    stockAsset({ id: "a2", symbol: "BBB" }),
    position({ id: "p2", asset_id: "a2", quantity: 0, avg_cost: 10, total_fee: 5, closed_at: currentSettlementDate() }),
    quote({ asset_id: "a2", latest_price: 12, previous_close: 10 }),
    "CNY",
    null,
    null,
    [pnlTx("SELL", 100, 12)],
  );
  assert.equal(archived.today_pnl.amount, 200);

  // 不传 archived：今日只含活跃 (11 - 10) * 100 = 100
  assert.equal(computeOverview([active], "CNY").today_pnl, 100);

  // 传 archived：今日含当天清仓资产 200 → 300；市值/总盈亏仅来自活跃持仓
  const ov = computeOverview([active], "CNY", [archived]);
  assert.equal(ov.today_pnl, 300);
  assert.equal(ov.total_market_value, 1100); // 仅活跃 11 * 100
  assert.equal(ov.total_pnl, 100); // 仅活跃 (11 - 10) * 100
});

test("昨日清仓资产的已实现盈亏计入昨日盈亏（无昨日快照，按交易流水确认）", () => {
  // 昨日全部卖出 100 @ 120（前日收盘 100）→ 昨日已实现 (120 - 100) * 100 = 2000
  const archived = computeHolding(
    stockAsset({ id: "a2", symbol: "BBB" }),
    position({
      id: "p2",
      asset_id: "a2",
      quantity: 0,
      avg_cost: 100,
      total_fee: 0,
      closed_at: `${previousDate()}T10:00:00.000Z`,
    }),
    quote({ asset_id: "a2", latest_price: 118, previous_close: 118, pre_previous_close: 100 }),
    "CNY",
    null,
    null, // 无昨日快照
    [pnlTx("SELL", 100, 120, `${previousDate()}T10:00:00.000Z`)],
  );
  assert.equal(archived.yesterday_pnl.amount, 2000);
  assert.equal(archived.yesterday_pnl.basis, 10000); // 期初 100 股 × 前日收盘 100
  assert.equal(archived.yesterday_pnl.percent, 20);
  // 昨日清仓资产今日不再有持仓/交易 → 今日盈亏为 0，不污染今日
  assert.equal(archived.today_pnl.amount, 0);

  const active = computeHolding(
    stockAsset({ id: "a1", symbol: "AAA" }),
    position({ id: "p1", asset_id: "a1", quantity: 100, avg_cost: 10, total_fee: 0 }),
    quote({ asset_id: "a1", latest_price: 11, previous_close: 10, pre_previous_close: 10 }),
    "CNY",
    null,
    dailyRow({ asset_id: "a1", quantity: 100, close_price: 10, daily_pnl_amount: 300, date: previousDate() }),
  );
  // 不传 archived：昨日只含活跃 300
  assert.equal(computeOverview([active], "CNY").yesterday_pnl, 300);
  // 传 archived：昨日含昨日清仓资产 2000 → 2300；市值/总盈亏仅来自活跃持仓
  const ov = computeOverview([active], "CNY", [archived]);
  assert.equal(ov.yesterday_pnl, 2300);
  assert.equal(ov.total_market_value, 1100); // 仅活跃 11 * 100
  assert.equal(ov.total_pnl, 100); // 仅活跃 (11 - 10) * 100
});

test("总览按结算币种汇总（同币种）", () => {
  const h = computeHolding(stockAsset(), position(), quote(), "CNY");
  const ov = computeOverview([h], "CNY");
  assert.equal(ov.total_market_value, 11000); // 110 * 100
  assert.equal(ov.today_pnl, 500);
  assert.equal(ov.total_pnl, 990);
  assert.equal(ov.fx_available, true);
});
