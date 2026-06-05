import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDailyCostStates, walkCost } from "./position.js";

const t = (side: "BUY" | "SELL", quantity: number, price: number, fee = 0, trade_time = "2026-01-01") => ({
  side,
  quantity,
  price,
  fee,
  trade_time,
});

test("单笔买入：成本=买入价，费用单列", () => {
  const r = walkCost([t("BUY", 100, 10, 5)]);
  assert.equal(r.quantity, 100);
  assert.equal(r.avg_cost, 10);
  assert.equal(r.total_fee, 5);
});

test("两笔买入加仓：加权平均成本", () => {
  // 100@10 + 100@20 → 均价 15
  const r = walkCost([t("BUY", 100, 10, 5, "2026-01-01"), t("BUY", 100, 20, 5, "2026-02-01")]);
  assert.equal(r.quantity, 200);
  assert.equal(r.avg_cost, 15);
  assert.equal(r.total_fee, 10);
});

test("买入后部分卖出：成本价不变，数量减少", () => {
  const r = walkCost([t("BUY", 200, 15, 0), t("SELL", 50, 30, 0)]);
  assert.equal(r.quantity, 150);
  assert.equal(r.avg_cost, 15); // 加权平均法：卖出不改变成本
});

test("全部卖出：数量归零并标记清仓时间", () => {
  const r = walkCost([
    t("BUY", 100, 10, 0, "2026-01-01"),
    t("SELL", 100, 12, 0, "2026-03-01"),
  ]);
  assert.equal(r.quantity, 0);
  assert.equal(r.closed_at, "2026-03-01");
});

test("不规则份额加仓（基金）：加权平均", () => {
  // 1000@1.5 + 500@1.8 → (1500+900)/1500 = 1.6
  const r = walkCost([t("BUY", 1000, 1.5), t("BUY", 500, 1.8)]);
  assert.equal(r.quantity, 1500);
  assert.equal(r.avg_cost, 1.6);
});

test("按日期回放交易：返回每日收盘后的成本状态", () => {
  const states = buildDailyCostStates(
    [
      t("BUY", 100, 10, 5, "2026-01-02T10:00:00.000Z"),
      t("BUY", 100, 20, 5, "2026-01-04T10:00:00.000Z"),
      t("SELL", 50, 30, 1, "2026-01-05T10:00:00.000Z"),
    ],
    ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"],
  );

  assert.deepEqual(
    states.map((s) => [s.date, s.quantity, s.avg_cost, s.total_fee]),
    [
      ["2026-01-01", 0, 0, 0],
      ["2026-01-02", 100, 10, 5],
      ["2026-01-03", 100, 10, 5],
      ["2026-01-04", 200, 15, 10],
      ["2026-01-05", 150, 15, 11],
    ],
  );
});
