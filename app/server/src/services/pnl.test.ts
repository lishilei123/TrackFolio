import assert from "node:assert/strict";
import { test } from "node:test";
import type { Asset, Position, QuoteSnapshot } from "../domain/types.js";
import type { DailyPnlRow } from "../repositories/dailyPnl.js";
import { __setCurrentSettlementDateForTest, computeHolding, computeOverview, currentSettlementDate } from "./pnl.js";

__setCurrentSettlementDateForTest("2026-06-10");

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

test("无今日结算快照时今日盈亏按实时行情 = (最新价 - 上一收盘价) * 数量", () => {
  const h = computeHolding(stockAsset(), position(), quote(), "CNY");
  // (110 - 105) * 100 = 500
  assert.equal(h.today_pnl.amount, 500);
  assert.equal(h.today_pnl.computable, true);
  // 500 / (105 * 100) = 4.7619%
  assert.ok(Math.abs((h.today_pnl.percent ?? 0) - 4.7619) < 0.001);
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

test("美股新一场开盘时：忽略上一场落到今日的结算快照，今日盈亏按实时行情计算", () => {
  // 美股上一场收盘快照会落到当前北京日期；当晚新一场开盘后必须用实时行情，而非旧快照。
  const h = computeHolding(
    stockAsset({ market: "US", currency: "USD", symbol: "AAPL" }),
    position({ quantity: 100, avg_cost: 90 }),
    quote({ latest_price: 110, previous_close: 105, market_status: "open" }),
    "USD",
    dailyRow({ quantity: 100, daily_pnl_amount: -910, date: currentSettlementDate(), currency: "USD" }),
  );
  // (110 - 105) * 100 = 500（实时），而非上一场快照的 -910
  assert.equal(h.today_pnl.amount, 500);
  assert.notEqual(h.today_pnl.amount, -910);
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

test("港股行情没覆盖到昨日时昨日盈亏记 0，并忽略旧快照", () => {
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
    assert.equal(h.yesterday_pnl.amount, 0);
    assert.equal(h.yesterday_pnl.percent, 0);
    assert.equal(h.yesterday_pnl.computable, true);
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

test("总览按结算币种汇总（同币种）", () => {
  const h = computeHolding(stockAsset(), position(), quote(), "CNY");
  const ov = computeOverview([h], "CNY");
  assert.equal(ov.total_market_value, 11000); // 110 * 100
  assert.equal(ov.today_pnl, 500);
  assert.equal(ov.total_pnl, 990);
  assert.equal(ov.fx_available, true);
});
