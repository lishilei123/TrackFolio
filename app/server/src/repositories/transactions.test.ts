import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, beforeEach, test } from "node:test";
import { initDb } from "../db/index.js";
import { assetsRepo } from "./assets.js";
import { transactionsRepo } from "./transactions.js";

delete process.env.DATABASE_URL;
process.env.TRACKFOLIO_DB = join(mkdtempSync(join(tmpdir(), "trackfolio-transactions-")), "test.sqlite");

before(async () => {
  await initDb();
});

beforeEach(async () => {
  for (const asset of await assetsRepo.list()) await assetsRepo.remove(asset.id);
});

test("交易备注创建、修改和清空都会落库", async () => {
  const asset = await assetsRepo.create({
    asset_type: "STOCK",
    market: "CN",
    symbol: "600519",
    name: "贵州茅台",
    currency: "CNY",
  });

  const created = await transactionsRepo.create({
    asset_id: asset.id,
    side: "BUY",
    quantity: 1,
    price: 100,
    currency: "CNY",
    note: "首笔备注",
  });
  assert.equal(created.note, "首笔备注");

  const updated = await transactionsRepo.update(created.id, { note: "更新后的备注" });
  assert.equal(updated?.note, "更新后的备注");

  const cleared = await transactionsRepo.update(created.id, { note: null });
  assert.equal(cleared?.note, null);
});

test("批量创建同成交时间交易时按入参顺序生成稳定 created_at", async () => {
  const asset = await assetsRepo.create({
    asset_type: "STOCK",
    market: "CN",
    symbol: "000001",
    name: "平安银行",
    currency: "CNY",
  });
  const sameTradeTime = "2026-01-01T00:00:00.000Z";

  const created = await transactionsRepo.createMany([
    {
      asset_id: asset.id,
      side: "BUY",
      quantity: 100,
      price: 10,
      currency: "CNY",
      trade_time: sameTradeTime,
      note: "first",
    },
    {
      asset_id: asset.id,
      side: "SELL",
      quantity: 50,
      price: 12,
      currency: "CNY",
      trade_time: sameTradeTime,
      note: "second",
    },
  ]);

  assert.ok(created[0].created_at < created[1].created_at);
  const listed = await transactionsRepo.listByAsset(asset.id);
  assert.deepEqual(listed.map((tx) => tx.note), ["first", "second"]);
});
