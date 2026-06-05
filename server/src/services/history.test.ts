import assert from "node:assert/strict";
import { test } from "node:test";
import type { Asset, Currency } from "../domain/types.js";
import type { DailyPnlRow } from "../repositories/dailyPnl.js";
import { aggregateHistory, buildTransactionAwareDailyPnlRows } from "./history.js";
import type { CostTx } from "./position.js";

function row(over: Partial<DailyPnlRow> = {}): DailyPnlRow {
  return {
    date: "2026-06-01",
    asset_id: "a1",
    market: "CN",
    asset_type: "STOCK",
    quantity: 100,
    close_price: 110,
    nav: null,
    daily_pnl_amount: 500,
    total_pnl_amount: 990,
    currency: "CNY",
    is_estimated: 0,
    created_at: "",
    ...over,
  };
}

const identity = (): number => 1;

function asset(over: Partial<Asset> = {}): Asset {
  return {
    id: "a1",
    asset_type: "STOCK",
    market: "CN",
    symbol: "600519",
    name: "测试股票",
    currency: "CNY",
    exchange: null,
    fund_type: null,
    quote_status: "ok",
    created_at: "",
    updated_at: "",
    ...over,
  };
}

const tx = (side: "BUY" | "SELL", quantity: number, price: number, fee = 0, trade_time = "2026-01-01"): CostTx => ({
  side,
  quantity,
  price,
  fee,
  trade_time,
});

const point = (date: string, close: number) => ({ date, close });

test("按日粒度：每日盈亏求和、累计取当日时点值", () => {
  const rows = [
    row({ date: "2026-06-01", daily_pnl_amount: 100, total_pnl_amount: 100 }),
    row({ date: "2026-06-02", daily_pnl_amount: 50, total_pnl_amount: 150 }),
  ];
  const r = aggregateHistory(rows, "CNY", "day", identity);
  assert.equal(r.points.length, 2);
  assert.deepEqual(
    r.points.map((p) => [p.date, p.daily_pnl, p.total_pnl]),
    [
      ["2026-06-01", 100, 100],
      ["2026-06-02", 50, 150],
    ],
  );
});

test("跨资产同日：daily 求和、total 求和、top_contributor 取贡献最大", () => {
  const rows = [
    row({ asset_id: "a1", daily_pnl_amount: 100, total_pnl_amount: 100 }),
    row({ asset_id: "a2", daily_pnl_amount: -300, total_pnl_amount: 50 }),
  ];
  const r = aggregateHistory(rows, "CNY", "day", identity, (id) => id);
  assert.equal(r.points[0].daily_pnl, -200); // 100 + (-300)
  assert.equal(r.points[0].total_pnl, 150); // 100 + 50
  assert.equal(r.points[0].top_contributor, "a2"); // |−300| 最大
});

test("月粒度：daily 桶内求和、total 取桶内最后一天", () => {
  const rows = [
    row({ date: "2026-06-01", daily_pnl_amount: 100, total_pnl_amount: 1000 }),
    row({ date: "2026-06-20", daily_pnl_amount: 200, total_pnl_amount: 1300 }),
    row({ date: "2026-07-03", daily_pnl_amount: 50, total_pnl_amount: 1350 }),
  ];
  const r = aggregateHistory(rows, "CNY", "month", identity);
  assert.equal(r.points.length, 2);
  // 6月桶：daily 100+200=300，total 取 6-20 的 1300，代表日期为桶内最后一天
  assert.deepEqual([r.points[0].date, r.points[0].daily_pnl, r.points[0].total_pnl], [
    "2026-06-20",
    300,
    1300,
  ]);
  assert.deepEqual([r.points[1].date, r.points[1].daily_pnl, r.points[1].total_pnl], [
    "2026-07-03",
    50,
    1350,
  ]);
});

test("跨币种按汇率折算", () => {
  const rows = [row({ currency: "USD", daily_pnl_amount: 10, total_pnl_amount: 20 })];
  const getRate = (from: Currency, to: Currency): number | null =>
    from === "USD" && to === "CNY" ? 7 : 1;
  const r = aggregateHistory(rows, "CNY", "day", getRate);
  assert.equal(r.points[0].daily_pnl, 70); // 10 * 7
  assert.equal(r.points[0].total_pnl, 140); // 20 * 7
});

test("缺失汇率的资产被跳过并标记 fx_available=false", () => {
  const rows = [
    row({ asset_id: "a1", currency: "CNY", daily_pnl_amount: 100, total_pnl_amount: 100 }),
    row({ asset_id: "a2", currency: "HKD", daily_pnl_amount: 999, total_pnl_amount: 999 }),
  ];
  const getRate = (from: Currency): number | null => (from === "HKD" ? null : 1);
  const r = aggregateHistory(rows, "CNY", "day", getRate);
  assert.equal(r.fx_available, false);
  assert.equal(r.points[0].daily_pnl, 100); // 仅 a1 计入
});

test("任一估算行 → is_estimated=true", () => {
  const r = aggregateHistory([row({ is_estimated: 1 })], "CNY", "day", identity);
  assert.equal(r.is_estimated, true);
});

test("缺失当日盈亏（首日无上一收盘）只影响 daily，不影响 total", () => {
  const rows = [row({ daily_pnl_amount: null, total_pnl_amount: 990 })];
  const r = aggregateHistory(rows, "CNY", "day", identity);
  assert.equal(r.points[0].daily_pnl, 0);
  assert.equal(r.points[0].total_pnl, 990);
  assert.equal(r.points[0].top_contributor, null);
});

test("交易感知历史快照：从持仓日开始生成，建仓首日 daily 按收盘价与买入均价计算", () => {
  const rows = buildTransactionAwareDailyPnlRows(
    asset(),
    [tx("BUY", 100, 10, 5, "2026-01-02T10:00:00.000Z")],
    [point("2026-01-01", 9), point("2026-01-02", 11), point("2026-01-03", 12)],
  );

  assert.deepEqual(rows.map((r) => r.date), ["2026-01-02", "2026-01-03"]);
  assert.equal(rows[0].quantity, 100);
  assert.equal(rows[0].daily_pnl_amount, 100);
  assert.equal(rows[0].total_pnl_amount, 95);
  assert.equal(rows[1].daily_pnl_amount, 100);
  assert.equal(rows[1].total_pnl_amount, 195);
  assert.equal(rows[1].is_estimated, 1);
});

test("交易感知历史快照：加仓按日期更新数量与平均成本", () => {
  const rows = buildTransactionAwareDailyPnlRows(
    asset(),
    [
      tx("BUY", 100, 10, 5, "2026-01-02T10:00:00.000Z"),
      tx("BUY", 100, 20, 5, "2026-01-04T10:00:00.000Z"),
    ],
    [point("2026-01-02", 10), point("2026-01-03", 12), point("2026-01-04", 18)],
  );

  assert.deepEqual(
    rows.map((r) => [r.date, r.quantity, r.daily_pnl_amount, r.total_pnl_amount]),
    [
      ["2026-01-02", 100, 0, -5],
      ["2026-01-03", 100, 200, 195],
      ["2026-01-04", 200, 1200, 590],
    ],
  );
});

test("交易感知历史快照：卖出减少数量但不改变平均成本", () => {
  const rows = buildTransactionAwareDailyPnlRows(
    asset(),
    [
      tx("BUY", 200, 10, 0, "2026-01-02T10:00:00.000Z"),
      tx("SELL", 50, 30, 1, "2026-01-04T10:00:00.000Z"),
    ],
    [point("2026-01-02", 10), point("2026-01-03", 12), point("2026-01-04", 14)],
  );

  const last = rows[2];
  assert.equal(last.quantity, 150);
  assert.equal(last.daily_pnl_amount, 300); // (14 - 12) * 150
  assert.equal(last.total_pnl_amount, 599); // (14 - 10) * 150 - 1
});

test("交易感知历史快照：清仓后停止生成，重新建仓首日 daily 按新买入均价计算", () => {
  const rows = buildTransactionAwareDailyPnlRows(
    asset(),
    [
      tx("BUY", 100, 10, 0, "2026-01-02T10:00:00.000Z"),
      tx("SELL", 100, 12, 0, "2026-01-04T10:00:00.000Z"),
      tx("BUY", 50, 18, 0, "2026-01-06T10:00:00.000Z"),
    ],
    [
      point("2026-01-02", 10),
      point("2026-01-03", 11),
      point("2026-01-04", 12),
      point("2026-01-05", 18),
      point("2026-01-06", 20),
      point("2026-01-07", 22),
    ],
  );

  assert.deepEqual(rows.map((r) => r.date), ["2026-01-02", "2026-01-03", "2026-01-06", "2026-01-07"]);
  assert.equal(rows[0].daily_pnl_amount, 0);
  assert.equal(rows[1].daily_pnl_amount, 100);
  assert.equal(rows[2].daily_pnl_amount, 100);
  assert.equal(rows[3].daily_pnl_amount, 100);
});
