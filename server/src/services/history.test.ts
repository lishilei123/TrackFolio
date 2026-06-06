import assert from "node:assert/strict";
import { test } from "node:test";
import type { Asset, Currency } from "../domain/types.js";
import type { DailyPnlRow } from "../repositories/dailyPnl.js";
import {
  aggregateHistory,
  buildTransactionAwareDailyPnlRows,
  incrementalDailyPnl,
  isCarryForwardSnapshot,
  snapshotDailyPnl,
  snapshotDateForQuote,
} from "./history.js";
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

test("按日粒度：首点用原始 daily，后续点用累计盈亏相邻差值", () => {
  const rows = [
    row({ date: "2026-06-01", daily_pnl_amount: 999, total_pnl_amount: 100 }),
    row({ date: "2026-06-02", daily_pnl_amount: 999, total_pnl_amount: 150 }),
  ];
  const r = aggregateHistory(rows, "CNY", "day", identity);
  assert.equal(r.points.length, 2);
  assert.deepEqual(
    r.points.map((p) => [p.date, p.daily_pnl, p.total_pnl]),
    [
      ["2026-06-01", 999, 100],
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
  assert.equal(r.points[0].daily_pnl, -200); // 首个点使用底表 daily 求和：100 + (-300)
  assert.equal(r.points[0].total_pnl, 150); // 100 + 50
  assert.equal(r.points[0].top_contributor, "a2"); // |−300| 最大
});

test("contributions：各资产区间贡献 = 首桶底表 daily + 后续桶累计差值，逐桶累加", () => {
  const rows = [
    row({ asset_id: "a1", date: "2026-06-01", daily_pnl_amount: 100, total_pnl_amount: 100 }),
    row({ asset_id: "a1", date: "2026-06-02", daily_pnl_amount: 200, total_pnl_amount: 300 }),
    row({ asset_id: "a2", date: "2026-06-01", daily_pnl_amount: 50, total_pnl_amount: 50 }),
    row({ asset_id: "a2", date: "2026-06-02", daily_pnl_amount: 80, total_pnl_amount: 130 }),
  ];
  const r = aggregateHistory(rows, "CNY", "day", identity, (id) => id);
  const byId = Object.fromEntries(r.contributions.map((c) => [c.asset_id, c.value]));
  assert.equal(byId.a1, 300); // 100 + (300 - 100)
  assert.equal(byId.a2, 130); // 50 + (130 - 50)
});

test("月粒度：首桶 daily 桶内求和，后续桶 daily 取累计差值，total 取桶内最后一天", () => {
  const rows = [
    row({ date: "2026-06-01", daily_pnl_amount: 100, total_pnl_amount: 1000 }),
    row({ date: "2026-06-20", daily_pnl_amount: 200, total_pnl_amount: 1300 }),
    row({ date: "2026-07-03", daily_pnl_amount: 50, total_pnl_amount: 1350 }),
  ];
  const r = aggregateHistory(rows, "CNY", "month", identity);
  assert.equal(r.points.length, 2);
  // 6月桶是查询首桶：daily 使用桶内求和，total 取 6-20 的 1300，代表日期为桶内最后一天
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

test("周粒度：跨年周按桶开始日期排序，展示区间内第一天", () => {
  const rows = [
    row({ date: "2026-01-01", daily_pnl_amount: 100, total_pnl_amount: 100 }),
    row({ date: "2026-01-02", daily_pnl_amount: 50, total_pnl_amount: 150 }),
    row({ date: "2026-01-05", daily_pnl_amount: 20, total_pnl_amount: 170 }),
  ];
  const r = aggregateHistory(rows, "CNY", "week", identity);
  assert.deepEqual(
    r.points.map((p) => [p.date, p.daily_pnl, p.total_pnl]),
    [
      ["2026-01-01", 150, 150],
      ["2026-01-05", 20, 170],
    ],
  );
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

test("美股收盘按北京时间记账到次日", () => {
  assert.equal(
    snapshotDateForQuote(
      asset({ market: "US", currency: "USD", symbol: "QQQ" }),
      { quote_time: "2026-06-05T20:00:00.000Z", nav_date: null, market_status: "closed" },
      "2026-06-06",
    ),
    "2026-06-06",
  );
});

test("旧行情在当前记账日只结转累计，不重复计入当日盈亏", () => {
  const a = asset({ market: "HK", currency: "HKD", symbol: "07709" });
  const q = { quote_time: "2026-06-05T08:09:16.000Z", nav_date: null, market_status: "closed" as const };
  assert.equal(snapshotDateForQuote(a, q, "2026-06-06"), "2026-06-06");
  assert.equal(isCarryForwardSnapshot("2026-06-06", a, q), true);
});

test("场外基金快照日期优先使用净值日期，旧净值按当前日结转", () => {
  const a = asset({ asset_type: "FUND", fund_type: "otc", symbol: "000001" });
  const q = { quote_time: "2026-06-06T01:00:00.000Z", nav_date: "2026-06-05" };
  assert.equal(snapshotDateForQuote(a, q, "2026-06-06"), "2026-06-06");
  assert.equal(isCarryForwardSnapshot("2026-06-06", a, q), true);
});

test("实时快照当期盈亏按累计盈亏相邻快照差值计算", () => {
  assert.equal(incrementalDailyPnl(-58.87, -20.07), -38.8);
  assert.equal(incrementalDailyPnl(-1002.11, -1002.11), 0);
  assert.equal(incrementalDailyPnl(95, undefined), 95);
});

test("快照当日盈亏：有更早快照取累计差值，建仓后首条快照取按昨收的当日涨跌（而非整仓总盈亏）", () => {
  // 有更早快照：累计盈亏相邻差值
  assert.equal(snapshotDailyPnl(7, -58.87, -20.07), -38.8);
  // 无更早快照（首条）：用按昨收算出的当日涨跌，不能用总盈亏 95
  assert.equal(snapshotDailyPnl(12, 95, undefined), 12);
  assert.equal(snapshotDailyPnl(12, 95, null), 12);
  // 无更早快照且昨收缺失：当日不可计算，记 null（绝不回退成总盈亏）
  assert.equal(snapshotDailyPnl(null, 95, undefined), null);
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

test("交易感知历史快照：持仓早于历史窗口时，窗口首日缺上一收盘 → daily 记 null（不把累计浮盈当成单日）", () => {
  // 建仓在 2026-01-02，但历史 K 线只从 2026-01-05 起（窗口被截断）。
  // 首点 2026-01-05 不是真·建仓日，缺少上一持仓日收盘，daily 不可计算；total 仍按成本计算。
  const rows = buildTransactionAwareDailyPnlRows(
    asset(),
    [tx("BUY", 100, 10, 5, "2026-01-02T10:00:00.000Z")],
    [point("2026-01-05", 12), point("2026-01-06", 13)],
  );

  assert.deepEqual(rows.map((r) => r.date), ["2026-01-05", "2026-01-06"]);
  assert.equal(rows[0].daily_pnl_amount, null); // 不再是 (12-10)*100=200 的整仓浮盈
  assert.equal(rows[0].total_pnl_amount, 195); // (12-10)*100 - 5
  assert.equal(rows[1].daily_pnl_amount, 100); // (13-12)*100，用上一持仓日收盘
  assert.equal(rows[1].total_pnl_amount, 295);
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

test("交易感知历史快照：交易流水会先按时间排序", () => {
  const rows = buildTransactionAwareDailyPnlRows(
    asset(),
    [
      tx("BUY", 100, 20, 0, "2026-01-04T10:00:00.000Z"),
      tx("BUY", 100, 10, 0, "2026-01-02T10:00:00.000Z"),
    ],
    [point("2026-01-02", 10), point("2026-01-03", 12), point("2026-01-04", 18)],
  );

  assert.deepEqual(
    rows.map((r) => [r.date, r.quantity, r.daily_pnl_amount, r.total_pnl_amount]),
    [
      ["2026-01-02", 100, 0, 0],
      ["2026-01-03", 100, 200, 200],
      ["2026-01-04", 200, 1200, 600],
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
