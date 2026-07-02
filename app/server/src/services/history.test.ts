import assert from "node:assert/strict";
import { test } from "node:test";
import type { Asset, Currency } from "../domain/types.js";
import type { DailyPnlRow } from "../repositories/dailyPnl.js";
import { __setExtendedHoursPnlForTest } from "./extendedHoursPnl.js";
import {
  aggregateHistory,
  buildTransactionAwareDailyPnlRows,
  computeSnapshotTransactionAwareDailyPnl,
  filterValidHistoryPointsForAsset,
  hasLiveQuoteForSettlementDate,
  incrementalDailyPnl,
  isCarryForwardSnapshot,
  isValidSettlementSnapshotDate,
  mergeLiveTodayRows,
  snapshotDailyPnl,
  snapshotDailyPnlForQuote,
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

function withExtendedHoursPnl(settings: { premarket?: boolean; postmarket?: boolean }, fn: () => void): void {
  __setExtendedHoursPnlForTest(settings);
  try {
    fn();
  } finally {
    __setExtendedHoursPnlForTest({ premarket: null, postmarket: null });
  }
}

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

test("daily granularity uses stored daily values for every point", () => {
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
      ["2026-06-02", 999, 150],
    ],
  );
});

test("missing daily does not fall back to cumulative pnl delta", () => {
  const rows = [
    row({ date: "2026-06-01", daily_pnl_amount: 10, total_pnl_amount: 100 }),
    row({ date: "2026-06-02", daily_pnl_amount: null, total_pnl_amount: 500 }),
  ];
  const r = aggregateHistory(rows, "CNY", "day", identity);
  assert.deepEqual(
    r.points.map((p) => [p.date, p.daily_pnl, p.total_pnl, p.top_contributor]),
    [
      ["2026-06-01", 10, 100, "a1"],
      ["2026-06-02", 0, 500, null],
    ],
  );
});

test("total pnl carries forward asset totals when a later date has no row for that asset", () => {
  const rows = [
    row({ asset_id: "a1", date: "2026-06-01", daily_pnl_amount: 10, total_pnl_amount: 100 }),
    row({ asset_id: "a2", date: "2026-06-01", daily_pnl_amount: 20, total_pnl_amount: 200 }),
    row({ asset_id: "a1", date: "2026-06-02", daily_pnl_amount: 30, total_pnl_amount: 130 }),
  ];
  const r = aggregateHistory(rows, "CNY", "day", identity);
  assert.deepEqual(
    r.points.map((p) => [p.date, p.daily_pnl, p.total_pnl]),
    [
      ["2026-06-01", 30, 300],
      ["2026-06-02", 30, 330],
    ],
  );
});

test("某行 total 置空时：当期盈亏仍计入，累计 total 按 carry-forward 不被该行改写", () => {
  // a2 该日只有当期 daily（total_pnl_amount=null）：daily 计入当期，累计仅含 a1 的 130
  const rows = [
    row({ asset_id: "a1", date: "2026-06-01", daily_pnl_amount: 10, total_pnl_amount: 100 }),
    row({ asset_id: "a1", date: "2026-06-02", daily_pnl_amount: 30, total_pnl_amount: 130 }),
    row({ asset_id: "a2", date: "2026-06-02", daily_pnl_amount: 80, total_pnl_amount: null, quantity: 0 }),
  ];
  const r = aggregateHistory(rows, "CNY", "day", identity, (id) => id);
  assert.deepEqual(
    r.points.map((p) => [p.date, p.daily_pnl, p.total_pnl]),
    [
      ["2026-06-01", 10, 100],
      ["2026-06-02", 110, 130],
    ],
  );
  assert.equal(r.contributions.find((c) => c.asset_id === "a2")?.value, 80);
});

test("聚合层不按星期猜交易日，直接使用已写入的当期盈亏", () => {
  const r = aggregateHistory(
    [row({ market: "HK", currency: "HKD", date: "2026-06-06", daily_pnl_amount: 875, total_pnl_amount: -910 })],
    "HKD",
    "day",
    identity,
  );
  assert.deepEqual(r.points.map((p) => [p.date, p.daily_pnl, p.total_pnl, p.top_contributor]), [
    ["2026-06-06", 875, -910, "a1"],
  ]);
});

test("美股周六北京结算日仍计入当期盈亏", () => {
  const r = aggregateHistory(
    [row({ market: "US", currency: "USD", date: "2026-06-06", daily_pnl_amount: -32.3, total_pnl_amount: -70 })],
    "USD",
    "day",
    identity,
  );
  assert.deepEqual(r.points.map((p) => [p.date, p.daily_pnl, p.total_pnl, p.top_contributor]), [
    ["2026-06-06", -32.3, -70, "a1"],
  ]);
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

test("contributions are accumulated from stored daily values", () => {
  const rows = [
    row({ asset_id: "a1", date: "2026-06-01", daily_pnl_amount: 100, total_pnl_amount: 100 }),
    row({ asset_id: "a1", date: "2026-06-02", daily_pnl_amount: 200, total_pnl_amount: 300 }),
    row({ asset_id: "a2", date: "2026-06-01", daily_pnl_amount: 50, total_pnl_amount: 50 }),
    row({ asset_id: "a2", date: "2026-06-02", daily_pnl_amount: 80, total_pnl_amount: 130 }),
  ];
  const r = aggregateHistory(rows, "CNY", "day", identity, (id) => id);
  const byId = Object.fromEntries(r.contributions.map((c) => [c.asset_id, c.value]));
  assert.equal(byId.a1, 300); // 100 + 200
  assert.equal(byId.a2, 130); // 50 + 80
});

test("month granularity sums stored daily values and uses the last total in each bucket", () => {
  const rows = [
    row({ date: "2026-06-01", daily_pnl_amount: 100, total_pnl_amount: 1000 }),
    row({ date: "2026-06-19", daily_pnl_amount: 200, total_pnl_amount: 1300 }),
    row({ date: "2026-07-03", daily_pnl_amount: 50, total_pnl_amount: 1350 }),
  ];
  const r = aggregateHistory(rows, "CNY", "month", identity);
  assert.equal(r.points.length, 2);
  // 6月桶是查询首桶：daily 使用桶内求和，total 取 6-19 的 1300，代表日期为桶内最后一天
  assert.deepEqual([r.points[0].date, r.points[0].daily_pnl, r.points[0].total_pnl], [
    "2026-06-19",
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

test("美股收盘按美东结算时区记账到交易日当天", () => {
  assert.equal(
    snapshotDateForQuote(
      asset({ market: "US", currency: "USD", symbol: "QQQ" }),
      { quote_time: "2026-06-05T20:00:00.000Z", nav_date: null, market_status: "closed" },
      "2026-06-06",
      "America/New_York",
    ),
    "2026-06-05",
  );
  assert.equal(
    isValidSettlementSnapshotDate(asset({ market: "US", currency: "USD", symbol: "QQQ" }), "2026-06-05", "America/New_York"),
    true,
  );
  assert.equal(
    isValidSettlementSnapshotDate(asset({ market: "US", currency: "USD", symbol: "QQQ" }), "2026-06-06", "America/New_York"),
    false,
  );
});

test("旧行情不推进到当前休市日", () => {
  const a = asset({ market: "HK", currency: "HKD", symbol: "07709" });
  const q = { quote_time: "2026-06-05T08:09:16.000Z", nav_date: null, market_status: "closed" as const };
  assert.equal(snapshotDateForQuote(a, q, "2026-06-07"), "2026-06-05");
  assert.equal(isCarryForwardSnapshot("2026-06-06", a, q), true);
  assert.equal(snapshotDailyPnlForQuote("2026-06-06", a, q, 875, -910, -1775), 0);
});

test("港股盘前行情默认作为今日实时历史点", () => {
  const a = asset({ market: "HK", currency: "HKD", symbol: "00700" });
  const q = { quote_time: "2026-06-09T01:10:00.000Z", nav_date: null, market_status: "pre" as const };
  assert.equal(isCarryForwardSnapshot("2026-06-09", a, q), false);
  assert.equal(snapshotDailyPnlForQuote("2026-06-09", a, q, -2350, -910, -1775), -2350);
});

test("A股盘前行情默认作为今日实时历史点", () => {
  const a = asset({ market: "CN", currency: "CNY", symbol: "600519" });
  const q = { quote_time: "2026-06-09T01:20:00.000Z", nav_date: null, market_status: "pre" as const };
  assert.equal(isCarryForwardSnapshot("2026-06-09", a, q), false);
  assert.equal(snapshotDailyPnlForQuote("2026-06-09", a, q, -2350, -910, -1775), -2350);
});

test("美股盘前设置开启时行情可作为今日实时历史点", () => {
  withExtendedHoursPnl({ premarket: true }, () => {
    const a = asset({ market: "US", currency: "USD", symbol: "QQQ" });
    const q = { quote_time: "2026-06-17T10:03:00.000Z", nav_date: null, market_status: "pre" as const };
    assert.equal(isCarryForwardSnapshot("2026-06-17", a, q), false);
    assert.equal(snapshotDailyPnlForQuote("2026-06-17", a, q, 6.52, 1325.82, 1302.92), 6.52);
  });
});

test("A股/港股盘前默认按北京时间结算作为实时历史点", () => {
  withExtendedHoursPnl({ premarket: false }, () => {
    const cn = asset({ market: "CN", currency: "CNY", symbol: "600519" });
    const hk = asset({ market: "HK", currency: "HKD", symbol: "00700" });
    const cnQuote = { quote_time: "2026-06-09T01:20:00.000Z", nav_date: null, market_status: "pre" as const };
    const hkQuote = { quote_time: "2026-06-09T01:10:00.000Z", nav_date: null, market_status: "pre" as const };
    assert.equal(isCarryForwardSnapshot("2026-06-09", cn, cnQuote), false);
    assert.equal(isCarryForwardSnapshot("2026-06-09", hk, hkQuote), false);
    assert.equal(snapshotDailyPnlForQuote("2026-06-09", cn, cnQuote, 900, 1325.82, 1302.92), 900);
    assert.equal(snapshotDailyPnlForQuote("2026-06-09", hk, hkQuote, 900, 1325.82, 1302.92), 900);
  });
});

test("A股/港股盘前默认按美东结算时区作为对应结算日实时历史点", () => {
  withExtendedHoursPnl({ premarket: false }, () => {
    const cn = asset({ market: "CN", currency: "CNY", symbol: "600519" });
    const hk = asset({ market: "HK", currency: "HKD", symbol: "00700" });
    const cnQuote = { quote_time: "2026-06-17T01:20:00.000Z", nav_date: null, market_status: "pre" as const };
    const hkQuote = { quote_time: "2026-06-17T01:10:00.000Z", nav_date: null, market_status: "pre" as const };
    assert.equal(isCarryForwardSnapshot("2026-06-16", cn, cnQuote, "America/New_York"), false);
    assert.equal(isCarryForwardSnapshot("2026-06-16", hk, hkQuote, "America/New_York"), false);
    assert.equal(snapshotDailyPnlForQuote("2026-06-16", cn, cnQuote, 900, 1325.82, 1302.92, "America/New_York"), 900);
    assert.equal(snapshotDailyPnlForQuote("2026-06-16", hk, hkQuote, 900, 1325.82, 1302.92, "America/New_York"), 900);
  });
});

test("A股/港股盘后行情作为当日实时历史点", () => {
  const cn = asset({ market: "CN", currency: "CNY", symbol: "600519" });
  const hk = asset({ market: "HK", currency: "HKD", symbol: "00700" });
  const cnQuote = { quote_time: "2026-06-09T07:02:00.000Z", nav_date: null, market_status: "post" as const };
  const hkQuote = { quote_time: "2026-06-09T08:05:00.000Z", nav_date: null, market_status: "post" as const };

  assert.equal(isCarryForwardSnapshot("2026-06-09", cn, cnQuote), false);
  assert.equal(isCarryForwardSnapshot("2026-06-09", hk, hkQuote), false);
  assert.equal(snapshotDailyPnlForQuote("2026-06-09", cn, cnQuote, 900, 1325.82, 1302.92), 900);
  assert.equal(snapshotDailyPnlForQuote("2026-06-09", hk, hkQuote, 900, 1325.82, 1302.92), 900);

  withExtendedHoursPnl({ postmarket: true }, () => {
    assert.equal(isCarryForwardSnapshot("2026-06-09", cn, cnQuote), false);
    assert.equal(isCarryForwardSnapshot("2026-06-09", hk, hkQuote), false);
    assert.equal(snapshotDailyPnlForQuote("2026-06-09", cn, cnQuote, 900, 1325.82, 1302.92), 900);
    assert.equal(snapshotDailyPnlForQuote("2026-06-09", hk, hkQuote, 900, 1325.82, 1302.92), 900);
  });
});

test("场外基金快照日期优先使用净值日期，不把旧净值推进到休市日", () => {
  const a = asset({ asset_type: "FUND", fund_type: "otc", symbol: "000001" });
  const q = { quote_time: "2026-06-06T01:00:00.000Z", nav_date: "2026-06-05" };
  assert.equal(snapshotDateForQuote(a, q, "2026-06-06"), "2026-06-05");
  assert.equal(isCarryForwardSnapshot("2026-06-06", a, q), true);
});

test("结算快照日期过滤保留美股周六结算但排除港股周日休市点", () => {
  assert.equal(
    isValidSettlementSnapshotDate(asset({ market: "US", currency: "USD", symbol: "QQQ" }), "2026-06-06"),
    true,
  );
  assert.equal(
    isValidSettlementSnapshotDate(asset({ market: "US", currency: "USD", symbol: "QQQ" }), "2026-06-07"),
    false,
  );
  assert.equal(
    isValidSettlementSnapshotDate(asset({ market: "HK", currency: "HKD", symbol: "07709" }), "2026-06-07"),
    false,
  );
});

test("US Monday intraday quote can feed today's realtime history point without a settlement close", () => {
  const us = asset({ market: "US", currency: "USD", symbol: "AAPL" });
  assert.equal(isValidSettlementSnapshotDate(us, "2026-06-15", "Asia/Shanghai"), false);
  assert.equal(
    hasLiveQuoteForSettlementDate(
      us,
      "2026-06-15",
      { quote_time: "2026-06-15T14:00:00.000Z", market_status: "open" },
      "Asia/Shanghai",
    ),
    true,
  );
  assert.equal(
    hasLiveQuoteForSettlementDate(
      us,
      "2026-06-15",
      { quote_time: "2026-06-13T02:00:00.000Z", market_status: "closed" },
      "Asia/Shanghai",
    ),
    false,
  );
});

test("live today history rows replace only matching assets and keep other same-day snapshots", () => {
  const stored = [
    row({ asset_id: "cn", date: "2026-06-15", daily_pnl_amount: 12, total_pnl_amount: 120 }),
    row({ asset_id: "us", date: "2026-06-15", daily_pnl_amount: 5, total_pnl_amount: 50 }),
    row({ asset_id: "old", date: "2026-06-14", daily_pnl_amount: 3, total_pnl_amount: 30 }),
  ];
  const live = [
    row({ asset_id: "us", date: "2026-06-15", daily_pnl_amount: 8, total_pnl_amount: 80 }),
  ];

  assert.deepEqual(
    mergeLiveTodayRows(stored, "2026-06-15", live).map((r) => [r.asset_id, r.date, r.daily_pnl_amount, r.total_pnl_amount]),
    [
      ["cn", "2026-06-15", 12, 120],
      ["old", "2026-06-14", 3, 30],
      ["us", "2026-06-15", 8, 80],
    ],
  );
});

test("incrementalDailyPnl computes cumulative pnl deltas", () => {
  assert.equal(incrementalDailyPnl(-58.87, -20.07), -38.8);
  assert.equal(incrementalDailyPnl(-1002.11, -1002.11), 0);
  assert.equal(incrementalDailyPnl(95, undefined), 95);
});

test("snapshot daily pnl prefers quote daily and only falls back to cumulative delta when missing", () => {
  assert.equal(snapshotDailyPnl(7, -58.87, -20.07), 7);
  assert.equal(snapshotDailyPnl(null, -58.87, -20.07), -38.8);
  assert.equal(snapshotDailyPnl(12, 95, undefined), 12);
  assert.equal(snapshotDailyPnl(12, 95, null), 12);
  assert.equal(snapshotDailyPnl(null, 95, undefined), null);
});

test("realtime snapshot daily uses the snapshot trading date after midnight refresh", () => {
  const daily = computeSnapshotTransactionAwareDailyPnl(
    "2026-06-09",
    asset({ market: "HK", currency: "HKD", symbol: "07709" }),
    113.75,
    98.6,
    60,
    [
      tx("BUY", 35, 135, 18.61, "2026-06-04"),
      tx("BUY", 25, 105, 18.33, "2026-06-09"),
    ],
    false,
    "Asia/Shanghai",
  );

  assert.equal(daily.amount, 749);
  assert.equal(daily.computable, true);
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

test("transaction anchors are prepended when provider history starts after the first trade", () => {
  const rows = buildTransactionAwareDailyPnlRows(
    asset(),
    [tx("BUY", 100, 10, 5, "2026-01-02T10:00:00.000Z")],
    [point("2026-01-05", 12)],
  );

  assert.deepEqual(
    rows.map((r) => [r.date, r.quantity, r.close_price, r.daily_pnl_amount, r.total_pnl_amount]),
    [
      ["2026-01-02", 100, 10, 0, -5],
      ["2026-01-05", 100, 12, null, 195],
    ],
  );
});

test("transaction anchors follow US settlement date mapping", () => {
  const us = asset({ market: "US", currency: "USD", symbol: "DRAM" });
  const rows = buildTransactionAwareDailyPnlRows(
    us,
    [
      tx("BUY", 9, 60, 2.02, "2026-05-27T10:00:00.000Z"),
      tx("BUY", 5, 69, 0, "2026-06-03T10:00:00.000Z"),
    ],
    [point("2026-06-05", 55.79)],
  );

  assert.deepEqual(
    rows.map((r) => [r.date, r.quantity, r.daily_pnl_amount, Math.round((r.total_pnl_amount ?? 0) * 100) / 100]),
    [
      ["2026-05-28", 9, 0, -2.02],
      ["2026-06-04", 14, 0, -2.02],
      ["2026-06-06", 14, null, -105.96],
    ],
  );
});

test("交易感知历史快照：美股历史日期整体 +1 映射到北京结算日（值不变，仅平移标签）", () => {
  const us = asset({ market: "US", currency: "USD", symbol: "QQQ" });
  const rows = buildTransactionAwareDailyPnlRows(
    us,
    [tx("BUY", 100, 10, 5, "2026-01-02T10:00:00.000Z")],
    [point("2026-01-01", 9), point("2026-01-02", 11), point("2026-01-05", 12)],
  );
  // 日期各 +1（美股自然日 → 北京结算日），daily/total 与不偏移时完全相同
  assert.deepEqual(rows.map((r) => r.date), ["2026-01-03", "2026-01-06"]);
  assert.equal(rows[0].daily_pnl_amount, 100); // 建仓首日 (11-10)*100，判定仍用美股自然日，未被偏移破坏
  assert.equal(rows[0].total_pnl_amount, 95);
  assert.equal(rows[1].daily_pnl_amount, 100);
  assert.equal(rows[1].total_pnl_amount, 195);
});

test("交易感知历史快照：美东结算时区下美股历史日期不平移", () => {
  const us = asset({ market: "US", currency: "USD", symbol: "QQQ" });
  const rows = buildTransactionAwareDailyPnlRows(
    us,
    [tx("BUY", 100, 10, 5, "2026-01-02T10:00:00.000Z")],
    [point("2026-01-01", 9), point("2026-01-02", 11), point("2026-01-05", 12)],
    true,
    "America/New_York",
  );

  assert.deepEqual(rows.map((r) => r.date), ["2026-01-02", "2026-01-05"]);
  assert.equal(rows[0].daily_pnl_amount, 100);
  assert.equal(rows[1].daily_pnl_amount, 100);
});

test("交易感知历史快照：港股历史日期不偏移（日内交易，与北京结算日一致）", () => {
  const hk = asset({ market: "HK", currency: "HKD", symbol: "00700" });
  const rows = buildTransactionAwareDailyPnlRows(
    hk,
    [tx("BUY", 100, 10, 5, "2026-01-02T10:00:00.000Z")],
    [point("2026-01-01", 9), point("2026-01-02", 11), point("2026-01-03", 12)],
  );
  assert.deepEqual(rows.map((r) => r.date), ["2026-01-02", "2026-01-03"]);
});

test("过滤 provider 返回的港股周末历史点", () => {
  const hk = asset({ market: "HK", currency: "HKD", symbol: "07709" });
  const points = filterValidHistoryPointsForAsset(
    hk,
    [
      point("2026-06-04", 132.5),
      point("2026-06-05", 106.9),
      point("2026-06-07", 106.9),
      point("2026-06-08", 98.6),
    ],
  );

  assert.deepEqual(points.map((p) => p.date), ["2026-06-04", "2026-06-05", "2026-06-08"]);
});

test("过滤 provider 返回的港股交易所假期历史点", () => {
  const hk = asset({ market: "HK", currency: "HKD", symbol: "00700" });
  const points = filterValidHistoryPointsForAsset(
    hk,
    [point("2026-06-30", 100), point("2026-07-01", 100), point("2026-07-02", 110)],
  );

  assert.equal(isValidSettlementSnapshotDate(hk, "2026-07-01"), false);
  assert.deepEqual(points.map((p) => p.date), ["2026-06-30", "2026-07-02"]);
});

test("校验重算过滤美股周六自然日，避免生成北京周日折线点", () => {
  const us = asset({ market: "US", currency: "USD", symbol: "QQQ" });
  const points = filterValidHistoryPointsForAsset(
    us,
    [
      point("2026-06-05", 110),
      point("2026-06-06", 111),
      point("2026-06-08", 112),
    ],
  );
  const rows = buildTransactionAwareDailyPnlRows(
    us,
    [tx("BUY", 10, 100, 0, "2026-06-01T10:00:00.000Z")],
    points,
  );

  assert.deepEqual(points.map((p) => p.date), ["2026-06-05", "2026-06-08"]);
  assert.deepEqual(rows.map((r) => r.date), ["2026-06-02", "2026-06-06", "2026-06-09"]);
  assert.equal(rows.some((r) => r.date === "2026-06-07"), false);
});

test("交易锚点也会过滤无效结算日，避免周末交易日期生成周日点", () => {
  const us = asset({ market: "US", currency: "USD", symbol: "QQQ" });
  const rows = buildTransactionAwareDailyPnlRows(
    us,
    [tx("BUY", 10, 100, 0, "2026-06-06T10:00:00.000Z")],
    [point("2026-06-08", 112)],
  ).filter((r) => isValidSettlementSnapshotDate(us, r.date));

  assert.deepEqual(rows.map((r) => r.date), ["2026-06-09"]);
  assert.equal(rows.some((r) => r.date === "2026-06-07"), false);
});

test("交易感知历史快照：持仓早于历史窗口时，窗口首日缺上一收盘 → daily 记 null（不把累计浮盈当成单日）", () => {
  // 建仓在 2026-01-02，但历史 K 线只从 2026-01-05 起（窗口被截断）。
  // 首点 2026-01-05 不是真·建仓日，缺少上一持仓日收盘，daily 不可计算；total 仍按成本计算。
  const rows = buildTransactionAwareDailyPnlRows(
    asset(),
    [tx("BUY", 100, 10, 5, "2026-01-02T10:00:00.000Z")],
    [point("2026-01-05", 12), point("2026-01-06", 13)],
  );

  assert.deepEqual(rows.map((r) => r.date), ["2026-01-02", "2026-01-05", "2026-01-06"]);
  assert.equal(rows[0].daily_pnl_amount, 0);
  assert.equal(rows[0].total_pnl_amount, -5);
  assert.equal(rows[1].daily_pnl_amount, null); // 不再是 (12-10)*100=200 的整仓浮盈
  assert.equal(rows[1].total_pnl_amount, 195); // (12-10)*100 - 5
  assert.equal(rows[2].daily_pnl_amount, 100); // (13-12)*100，用上一持仓日收盘
  assert.equal(rows[2].total_pnl_amount, 295);
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
      ["2026-01-04", 200, 400, 590],
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
      ["2026-01-04", 200, 400, 600],
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
  assert.equal(last.daily_pnl_amount, 1200); // 卖出 (30 - 12) * 50 + 剩余 (14 - 12) * 150
  // 累计 = 已实现 (30 - 10) * 50 + 剩余浮盈 (14 - 10) * 150 - 费用 1 = 1000 + 600 - 1
  assert.equal(last.total_pnl_amount, 1599);
});

test("交易感知历史快照：清仓日补落袋已实现行；再建仓后累计含已落袋部分", () => {
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

  // 01-04 清仓：补一行 qty=0、total=已实现 (12-10)*100=200；01-05 维持 0 跳过；
  // 01-06 再建仓，累计仍含已落袋 200。
  assert.deepEqual(
    rows.map((r) => [r.date, r.quantity, r.daily_pnl_amount, r.total_pnl_amount]),
    [
      ["2026-01-02", 100, 0, 0],
      ["2026-01-03", 100, 100, 100],
      ["2026-01-04", 0, 100, 200],
      ["2026-01-06", 50, 100, 300], // 200 已实现 + (20-18)*50 浮盈
      ["2026-01-07", 50, 100, 400], // 200 已实现 + (22-18)*50 浮盈
    ],
  );
});

test("交易感知历史快照：全量清仓后末行累计 = 已实现净额（曲线不再残留陈旧浮盈）", () => {
  const rows = buildTransactionAwareDailyPnlRows(
    asset(),
    [
      tx("BUY", 100, 10, 5, "2026-01-02T10:00:00.000Z"),
      tx("SELL", 100, 15, 3, "2026-01-05T10:00:00.000Z"),
    ],
    [point("2026-01-02", 10), point("2026-01-03", 11), point("2026-01-05", 15), point("2026-01-06", 20)],
  );
  const last = rows[rows.length - 1];
  // 清仓日（01-05）后不再生成新行，末行即清仓行：已实现 (15-10)*100=500 − 累计费用 8 = 492
  assert.equal(last.date, "2026-01-05");
  assert.equal(last.quantity, 0);
  assert.equal(last.total_pnl_amount, 492);
  // 陈旧浮盈（如把 01-06 价 20 当成持仓）不会出现
  assert.equal(rows.some((r) => r.date === "2026-01-06"), false);
});
