import assert from "node:assert/strict";
import { test } from "node:test";
import { createBatchTransactionsSchema, createTransactionSchema, historyQuerySchema } from "./validate.js";

test("transaction dates reject malformed input", () => {
  assert.equal(
    createTransactionSchema.safeParse({ side: "BUY", quantity: 1, price: 10, trade_time: "not-a-date" }).success,
    false,
  );
  assert.equal(
    createTransactionSchema.safeParse({ side: "BUY", quantity: 1, price: 10, trade_time: "2026-02-31" }).success,
    false,
  );
  assert.equal(
    createTransactionSchema.safeParse({ side: "BUY", quantity: 1, price: 10, trade_time: "2026-01-02" }).success,
    true,
  );
});

test("transaction trade_time accepts datetime input but rejects bad date prefix", () => {
  // 带时间分量的 ISO 字符串应通过
  assert.equal(
    createTransactionSchema.safeParse({
      side: "BUY",
      quantity: 1,
      price: 10,
      trade_time: "2026-01-02T10:30:00.000Z",
    }).success,
    true,
  );
  // 日期前缀本身非法（2 月 30 日）应被拒
  assert.equal(
    createTransactionSchema.safeParse({
      side: "BUY",
      quantity: 1,
      price: 10,
      trade_time: "2026-02-30T10:30:00.000Z",
    }).success,
    false,
  );
});

test("pending SIP and history dates require real yyyy-mm-dd values", () => {
  assert.equal(
    createBatchTransactionsSchema.safeParse({
      transactions: [],
      pending: [{ trade_time: "2026-02-31", nav_date: "2026-02-28", sip_mode: "amount", per_value: 100 }],
    }).success,
    false,
  );
  assert.equal(historyQuerySchema.safeParse({ range: "custom", from: "2026-02-31", to: "2026-03-01" }).success, false);
  assert.equal(historyQuerySchema.safeParse({ range: "custom", from: "2026-02-28", to: "2026-03-01" }).success, true);
});
