import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, beforeEach, test } from "node:test";
import Fastify from "fastify";
import { initDb } from "../db/index.js";
import { assetsRepo } from "../repositories/assets.js";
import { dailyPnlRepo } from "../repositories/dailyPnl.js";
import { positionsRepo } from "../repositories/positions.js";
import { quotesRepo } from "../repositories/quotes.js";
import { settingsRepo } from "../repositories/settings.js";
import { fxService } from "../services/fx.js";
import { __setCurrentSettlementDateForTest, __setCurrentSettlementTimezoneForTest } from "../services/pnl.js";
import { historyRoutes } from "./history.js";
import { portfolioRoutes } from "./portfolio.js";

delete process.env.DATABASE_URL;
process.env.TRACKFOLIO_DB = join(mkdtempSync(join(tmpdir(), "trackfolio-portfolio-")), "test.sqlite");
process.env.QUOTE_PROVIDER = "mock";

before(async () => {
  await initDb();
  await settingsRepo.load();
  await fxService.loadCache();
});

beforeEach(async () => {
  for (const asset of await assetsRepo.list()) await assetsRepo.remove(asset.id);
});

async function testApp() {
  const app = Fastify({ logger: false });
  await app.register(portfolioRoutes);
  await app.register(historyRoutes);
  await app.ready();
  return app;
}

test("portfolio yesterday pnl ignores HK holiday rows and does not backfill the previous trading day", async () => {
  __setCurrentSettlementDateForTest("2026-07-02");
  __setCurrentSettlementTimezoneForTest("Asia/Shanghai");
  const app = await testApp();
  try {
    const hk = await assetsRepo.create({
      asset_type: "STOCK",
      market: "HK",
      symbol: "00700",
      name: "Tencent",
      currency: "HKD",
    });
    await positionsRepo.create({
      asset_id: hk.id,
      quantity: 100,
      avg_cost: 90,
      total_fee: 0,
      opened_at: "2026-06-01T10:00:00.000Z",
    });
    await quotesRepo.upsert({
      asset_id: hk.id,
      latest_price: 110,
      latest_nav: null,
      previous_close: 100,
      pre_previous_close: 95,
      previous_nav: null,
      nav_date: null,
      open: 101,
      high: 111,
      low: 100,
      volume: 1000,
      change_amount: 10,
      change_percent: 10,
      market_status: "open",
      quote_time: "2026-07-02T02:00:00.000Z",
      provider: "mock",
      status: "ok",
    });
    await dailyPnlRepo.upsert({
      date: "2026-06-30",
      asset_id: hk.id,
      market: "HK",
      asset_type: "STOCK",
      quantity: 90,
      close_price: 100,
      nav: null,
      daily_pnl_amount: 450,
      total_pnl_amount: 900,
      currency: "HKD",
      is_estimated: 0,
    });
    await dailyPnlRepo.upsert({
      date: "2026-07-01",
      asset_id: hk.id,
      market: "HK",
      asset_type: "STOCK",
      quantity: 90,
      close_price: 100,
      nav: null,
      daily_pnl_amount: 999,
      total_pnl_amount: 999,
      currency: "HKD",
      is_estimated: 0,
    });
    const cn = await assetsRepo.create({
      asset_type: "STOCK",
      market: "CN",
      symbol: "600519",
      name: "Moutai",
      currency: "CNY",
    });
    await positionsRepo.create({
      asset_id: cn.id,
      quantity: 100,
      avg_cost: 90,
      total_fee: 0,
      opened_at: "2026-06-01T10:00:00.000Z",
    });
    await quotesRepo.upsert({
      asset_id: cn.id,
      latest_price: 102,
      latest_nav: null,
      previous_close: 101,
      pre_previous_close: 100,
      previous_nav: null,
      nav_date: null,
      open: 101,
      high: 103,
      low: 100,
      volume: 1000,
      change_amount: 1,
      change_percent: 0.99,
      market_status: "open",
      quote_time: "2026-07-02T02:00:00.000Z",
      provider: "mock",
      status: "ok",
    });
    await dailyPnlRepo.upsert({
      date: "2026-07-01",
      asset_id: cn.id,
      market: "CN",
      asset_type: "STOCK",
      quantity: 100,
      close_price: 101,
      nav: null,
      daily_pnl_amount: 100,
      total_pnl_amount: 1100,
      currency: "CNY",
      is_estimated: 0,
    });

    const res = await app.inject({ method: "GET", url: "/api/portfolio?currency=CNY" });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    const hkHolding = body.holdings.find((h: { asset: { id: string } }) => h.asset.id === hk.id);
    assert.equal(hkHolding.yesterday_pnl.amount, 0);
    assert.equal(hkHolding.yesterday_pnl.percent, 0);
    assert.equal(body.overview.yesterday_pnl, 100);

    const history = await app.inject({
      method: "GET",
      url: "/api/history?from=2026-07-01&to=2026-07-01&currency=CNY",
    });
    assert.equal(history.statusCode, 200);
    assert.equal(history.json().points[0].daily_pnl, body.overview.yesterday_pnl);
  } finally {
    await app.close();
    __setCurrentSettlementDateForTest(null);
    __setCurrentSettlementTimezoneForTest(null);
  }
});
