import assert from "node:assert/strict";
import { test } from "node:test";
import { walkRealized } from "./position.js";

const t = (side: "BUY" | "SELL", quantity: number, price: number, fee = 0, trade_time = "2026-01-01") => ({
  side,
  quantity,
  price,
  fee,
  trade_time,
});

test("无卖出：无已实现盈亏记录", () => {
  assert.deepEqual(walkRealized([t("BUY", 100, 10, 5)]), []);
});

test("全量清仓：一条记录，已实现盈亏扣卖出费", () => {
  // 买 100@10，卖 100@12，卖出费 3 → (12-10)*100 - 3 = 197
  const lots = walkRealized([t("BUY", 100, 10, 5, "2026-01-01"), t("SELL", 100, 12, 3, "2026-03-01")]);
  assert.equal(lots.length, 1);
  assert.equal(lots[0].avg_cost, 10);
  assert.equal(lots[0].quantity, 100);
  assert.equal(lots[0].cost_basis, 1000);
  assert.equal(lots[0].proceeds, 1200);
  assert.equal(lots[0].fee, 3);
  assert.equal(lots[0].realized_pnl, 197);
  assert.equal(lots[0].realized_pnl_percent, 19.7);
  assert.equal(lots[0].trade_time, "2026-03-01");
});

test("部分减仓后仍持有：成本价用卖出当时均价", () => {
  // 买 200@15，卖 50@30 → (30-15)*50 = 750
  const lots = walkRealized([t("BUY", 200, 15, 0), t("SELL", 50, 30, 0, "2026-02-01")]);
  assert.equal(lots.length, 1);
  assert.equal(lots[0].avg_cost, 15);
  assert.equal(lots[0].realized_pnl, 750);
});

test("多次买入摊薄后卖出：按加权均价计算已实现盈亏", () => {
  // 100@10 + 100@20 → 均价 15；卖 100@25 → (25-15)*100 = 1000
  const lots = walkRealized([
    t("BUY", 100, 10, 0, "2026-01-01"),
    t("BUY", 100, 20, 0, "2026-01-02"),
    t("SELL", 100, 25, 0, "2026-01-03"),
  ]);
  assert.equal(lots.length, 1);
  assert.equal(lots[0].avg_cost, 15);
  assert.equal(lots[0].realized_pnl, 1000);
});

test("多笔买卖交替：每笔卖出各生成一条，均价随后续买入更新", () => {
  // 100@10，卖 40@12 →(12-10)*40=80；再买 60@20 → 剩 60@10 与 60@20 → 均价 15；卖 50@18 →(18-15)*50=150
  const lots = walkRealized([
    t("BUY", 100, 10, 0, "2026-01-01"),
    t("SELL", 40, 12, 0, "2026-01-02"),
    t("BUY", 60, 20, 0, "2026-01-03"),
    t("SELL", 50, 18, 0, "2026-01-04"),
  ]);
  assert.equal(lots.length, 2);
  assert.equal(lots[0].avg_cost, 10);
  assert.equal(lots[0].realized_pnl, 80);
  assert.equal(lots[1].avg_cost, 15);
  assert.equal(lots[1].realized_pnl, 150);
});

test("亏损卖出：已实现盈亏为负", () => {
  // 买 100@10，卖 100@8，费 2 → (8-10)*100 - 2 = -202
  const lots = walkRealized([t("BUY", 100, 10, 0), t("SELL", 100, 8, 2, "2026-02-01")]);
  assert.equal(lots[0].realized_pnl, -202);
  assert.equal(lots[0].realized_pnl_percent, -20.2);
});
