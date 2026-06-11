import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDailyCostStates, validateCostFlow, walkCost } from "./position.js";

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

test("卖出数量不能超过当时可用持仓", () => {
  assert.throws(
    () => walkCost([t("BUY", 100, 10, 0, "2026-01-02"), t("SELL", 101, 12, 0, "2026-01-03")]),
    /sell_quantity_exceeds_position/,
  );
});

test("validateCostFlow：合法流水返回 null，卖超返回 reason", () => {
  assert.equal(validateCostFlow([t("BUY", 100, 10, 0, "2026-01-01"), t("SELL", 100, 12, 0, "2026-01-02")]), null);
  assert.equal(
    validateCostFlow([t("BUY", 100, 10, 0, "2026-01-01"), t("SELL", 101, 12, 0, "2026-01-02")]),
    "sell_quantity_exceeds_position",
  );
});

test("validateCostFlow：乱序输入按 trade_time 回放，先买后卖合法", () => {
  // 故意把卖出排在买入之前传入，排序后仍应判定为合法
  assert.equal(
    validateCostFlow([t("SELL", 100, 12, 0, "2026-01-02"), t("BUY", 100, 10, 0, "2026-01-01")]),
    null,
  );
});

test("validateCostFlow：同一 trade_time 用 created_at 决定回放顺序", () => {
  const sameDay = "2026-01-01T00:00:00.000Z";
  const buyFirst = { ...t("BUY", 100, 10, 0, sameDay), created_at: "2026-01-01T08:00:00.000Z" };
  const sellAfter = { ...t("SELL", 100, 12, 0, sameDay), created_at: "2026-01-01T09:00:00.000Z" };
  // 买在前（created_at 更早）→ 合法
  assert.equal(validateCostFlow([sellAfter, buyFirst]), null);

  // 同日卖在前（created_at 更早）、买在后 → 卖出时无持仓，非法
  const sellFirst = { ...t("SELL", 100, 12, 0, sameDay), created_at: "2026-01-01T08:00:00.000Z" };
  const buyAfter = { ...t("BUY", 100, 10, 0, sameDay), created_at: "2026-01-01T09:00:00.000Z" };
  assert.equal(validateCostFlow([buyAfter, sellFirst]), "sell_quantity_exceeds_position");
});

test("validateCostFlow：无 created_at 的待写入交易排在同日已有交易之后", () => {
  const existingBuy = { ...t("BUY", 100, 10, 0, "2026-01-01T00:00:00.000Z"), created_at: "2026-01-01T08:00:00.000Z" };
  // 新卖出无 created_at，应排在已有买入之后 → 合法
  const newSell = t("SELL", 100, 12, 0, "2026-01-01T00:00:00.000Z");
  assert.equal(validateCostFlow([existingBuy, newSell]), null);
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
