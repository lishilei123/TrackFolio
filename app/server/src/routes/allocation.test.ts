import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, beforeEach, test } from "node:test";
import Fastify from "fastify";
import { initDb } from "../db/index.js";
import { assetsRepo } from "../repositories/assets.js";
import { positionsRepo } from "../repositories/positions.js";
import { securityRepo } from "../repositories/security.js";
import { settingsRepo } from "../repositories/settings.js";
import { transactionsRepo } from "../repositories/transactions.js";
import { recomputePosition } from "../services/position.js";
import { allocationRoutes } from "./allocation.js";

delete process.env.DATABASE_URL;
process.env.TRACKFOLIO_DB = join(mkdtempSync(join(tmpdir(), "trackfolio-allocation-")), "test.sqlite");
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
  await app.register(allocationRoutes);
  await app.ready();
  return app;
}

test("导出只包含活跃持仓配置", async () => {
  const asset = await assetsRepo.create({
    asset_type: "STOCK",
    market: "CN",
    symbol: "600519",
    name: "贵州茅台",
    currency: "CNY",
  });
  await transactionsRepo.create({
    asset_id: asset.id,
    side: "BUY",
    quantity: 2,
    price: 100,
    fee: 1,
    currency: "CNY",
    trade_time: "2026-01-01T00:00:00.000Z",
    note: "首笔",
  });
  const position = await recomputePosition(asset.id);
  assert.ok(position);
  await positionsRepo.update(position.id, { tags: ["核心"], note: "配置备注" });

  const app = await testApp();
  try {
    const res = await app.inject({ method: "GET", url: "/api/allocation/export", headers: await unlockedHeaders() });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.schema, "trackfolio.assetAllocation.v1");
    assert.equal(body.holdings.length, 1);
    assert.deepEqual(body.holdings[0], {
      asset_type: "STOCK",
      market: "CN",
      symbol: "600519",
      name: "贵州茅台",
      currency: "CNY",
      exchange: null,
      fund_type: null,
      quantity: 2,
      avg_cost: 100,
      total_fee: 1,
      opened_at: "2026-01-01T00:00:00.000Z",
      tags: ["核心"],
      note: "配置备注",
    });
  } finally {
    await app.close();
  }
});

test("导入新资产会创建买入交易并重算持仓", async () => {
  const app = await testApp();
  try {
    const res = await app.inject({
      method: "POST",
      url: "/api/allocation/import",
      headers: await unlockedHeaders(),
      payload: {
        schema: "trackfolio.assetAllocation.v1",
        holdings: [
          {
            asset_type: "STOCK",
            market: "US",
            symbol: "aapl",
            name: "Apple",
            currency: "USD",
            quantity: 3,
            avg_cost: 150,
            total_fee: 2,
            opened_at: "2026-02-01T00:00:00.000Z",
            tags: ["海外"],
            note: "导入备注",
          },
        ],
      },
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().imported, 1);

    const asset = await assetsRepo.findByKey("STOCK", "US", "AAPL");
    assert.ok(asset);
    const txs = await transactionsRepo.listByAsset(asset.id);
    assert.equal(txs.length, 1);
    assert.equal(txs[0].side, "BUY");
    assert.equal(txs[0].quantity, 3);
    assert.equal(txs[0].price, 150);
    assert.equal(txs[0].fee, 2);
    const position = (await positionsRepo.listByAsset(asset.id))[0];
    assert.equal(position.quantity, 3);
    assert.equal(position.avg_cost, 150);
    assert.equal(position.total_fee, 2);
    assert.deepEqual(position.tags, ["海外"]);
    assert.equal(position.note, "导入备注");
  } finally {
    await app.close();
  }
});

test("重复导入默认跳过已有活跃持仓，append 模式会加仓", async () => {
  const app = await testApp();
  try {
    const payload = {
      schema: "trackfolio.assetAllocation.v1",
      holdings: [
        {
          asset_type: "STOCK",
          market: "CN",
          symbol: "600519",
          name: "贵州茅台",
          currency: "CNY",
          quantity: 1,
          avg_cost: 100,
        },
      ],
    };

    let res = await app.inject({ method: "POST", url: "/api/allocation/import", headers: await unlockedHeaders(), payload });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().imported, 1);

    res = await app.inject({ method: "POST", url: "/api/allocation/import", headers: await unlockedHeaders(), payload });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().skipped, 1);
    const asset = await assetsRepo.findByKey("STOCK", "CN", "600519");
    assert.ok(asset);
    assert.equal((await transactionsRepo.listByAsset(asset.id)).length, 1);

    res = await app.inject({
      method: "POST",
      url: "/api/allocation/import",
      headers: await unlockedHeaders(),
      payload: { ...payload, mode: "append" },
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().imported, 1);
    assert.equal((await transactionsRepo.listByAsset(asset.id)).length, 2);
    const position = (await positionsRepo.listByAsset(asset.id))[0];
    assert.equal(position.quantity, 2);
    assert.equal(position.avg_cost, 100);
  } finally {
    await app.close();
  }
});

test("非法资产配置导入会返回校验错误", async () => {
  const app = await testApp();
  try {
    const res = await app.inject({
      method: "POST",
      url: "/api/allocation/import",
      headers: await unlockedHeaders(),
      payload: {
        schema: "trackfolio.assetAllocation.v1",
        holdings: [{ asset_type: "STOCK", market: "CN", symbol: "ABC", name: "bad", quantity: -1, avg_cost: 1 }],
      },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, "参数校验失败");
  } finally {
    await app.close();
  }
});
