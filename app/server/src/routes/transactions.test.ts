import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, beforeEach, test } from "node:test";
import Fastify from "fastify";
import { initDb } from "../db/index.js";
import { assetsRepo } from "../repositories/assets.js";
import { securityRepo } from "../repositories/security.js";
import { settingsRepo } from "../repositories/settings.js";
import { transactionsRepo } from "../repositories/transactions.js";
import { recomputePosition } from "../services/position.js";
import { transactionRoutes } from "./transactions.js";

delete process.env.DATABASE_URL;
process.env.TRACKFOLIO_DB = join(mkdtempSync(join(tmpdir(), "trackfolio-transactions-")), "test.sqlite");
process.env.QUOTE_PROVIDER = "mock";

before(async () => {
  await initDb();
  await settingsRepo.load();
});

beforeEach(async () => {
  for (const asset of await assetsRepo.list()) await assetsRepo.remove(asset.id);
});

async function unlockedHeaders() {
  const session = await securityRepo.unlock();
  return {
    origin: "http://localhost",
    host: "localhost",
    "x-admin-token": session.token!,
  };
}

async function testApp() {
  const app = Fastify({ logger: false });
  await app.register(transactionRoutes);
  await app.ready();
  return app;
}

/** 建一只资产并落两笔流水：BUY 100 / SELL 60，返回买入交易 id */
async function seedBuyThenSell() {
  const asset = await assetsRepo.create({
    asset_type: "STOCK",
    market: "CN",
    symbol: "600519",
    name: "贵州茅台",
    currency: "CNY",
  });
  const buy = await transactionsRepo.create({
    asset_id: asset.id,
    side: "BUY",
    quantity: 100,
    price: 10,
    fee: 0,
    currency: "CNY",
    trade_time: "2026-01-01T00:00:00.000Z",
    note: null,
  });
  await transactionsRepo.create({
    asset_id: asset.id,
    side: "SELL",
    quantity: 60,
    price: 12,
    fee: 0,
    currency: "CNY",
    trade_time: "2026-01-02T00:00:00.000Z",
    note: null,
  });
  await recomputePosition(asset.id);
  return { asset, buyId: buy.id };
}

test("编辑买入数量导致后续卖出超量时被拒", async () => {
  const { buyId } = await seedBuyThenSell();
  const app = await testApp();
  try {
    // BUY 100 → 50，则后续 SELL 60 超过可用持仓，应 400
    const res = await app.inject({
      method: "PATCH",
      url: `/api/transactions/${buyId}`,
      headers: await unlockedHeaders(),
      payload: { quantity: 50 },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, "卖出数量超过可用持仓");
    // 校验失败不应改动流水
    const buy = await transactionsRepo.get(buyId);
    assert.equal(buy?.quantity, 100);
  } finally {
    await app.close();
  }
});

test("编辑买入数量仍能覆盖后续卖出时成功并重算持仓", async () => {
  const { asset, buyId } = await seedBuyThenSell();
  const app = await testApp();
  try {
    // BUY 100 → 80，SELL 60 后剩 20，合法
    const res = await app.inject({
      method: "PATCH",
      url: `/api/transactions/${buyId}`,
      headers: await unlockedHeaders(),
      payload: { quantity: 80 },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().transaction.quantity, 80);
    assert.equal(res.json().position.quantity, 20);
    const buy = await transactionsRepo.get(buyId);
    assert.equal(buy?.quantity, 80);
    assert.equal((await transactionsRepo.listByAsset(asset.id)).length, 2);
  } finally {
    await app.close();
  }
});

test("新增卖出超过当前持仓时被拒", async () => {
  const { asset } = await seedBuyThenSell();
  const app = await testApp();
  try {
    // 当前持仓 40，再卖 50 应 400
    const res = await app.inject({
      method: "POST",
      url: `/api/assets/${asset.id}/transactions`,
      headers: await unlockedHeaders(),
      payload: { side: "SELL", quantity: 50, price: 12 },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, "卖出数量超过可用持仓");
    assert.equal((await transactionsRepo.listByAsset(asset.id)).length, 2);
  } finally {
    await app.close();
  }
});

test("删除买入导致后续卖出超量时被拒且不改动流水", async () => {
  const { asset, buyId } = await seedBuyThenSell();
  const app = await testApp();
  try {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/transactions/${buyId}`,
      headers: await unlockedHeaders(),
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, "卖出数量超过可用持仓");
    const txs = await transactionsRepo.listByAsset(asset.id);
    assert.equal(txs.length, 2);
    assert.deepEqual(txs.map((tx) => tx.side), ["BUY", "SELL"]);
  } finally {
    await app.close();
  }
});
