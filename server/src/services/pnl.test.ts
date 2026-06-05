import assert from "node:assert/strict";
import { test } from "node:test";
import type { Asset, Position, QuoteSnapshot } from "../domain/types.js";
import type { DailyPnlRow } from "../repositories/dailyPnl.js";
import { computeHolding, computeOverview } from "./pnl.js";

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
    quote_time: "2026-06-04T02:00:00.000Z",
    provider: "mock",
    status: "ok",
    ...over,
  };
}

function previousDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
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

test("今日盈亏 = (最新价 - 上一收盘价) * 数量", () => {
  const h = computeHolding(stockAsset(), position(), quote(), "CNY");
  // (110 - 105) * 100 = 500
  assert.equal(h.today_pnl.amount, 500);
  assert.equal(h.today_pnl.computable, true);
  // 500 / (105 * 100) = 4.7619%
  assert.ok(Math.abs((h.today_pnl.percent ?? 0) - 4.7619) < 0.001);
});

test("总持仓盈亏 = (最新价 - 成本) * 数量 - 费用", () => {
  const h = computeHolding(stockAsset(), position(), quote(), "CNY");
  // (110 - 100) * 100 - 10 = 990
  assert.equal(h.total_pnl.amount, 990);
  // 990 / (100*100 + 10) = 9.8901%
  assert.ok(Math.abs((h.total_pnl.percent ?? 0) - 9.8901) < 0.001);
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

test("缺少上一收盘价时今日盈亏不可计算", () => {
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
