import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";
import { initDb } from "../db/index.js";
import { settingsRepo } from "../repositories/settings.js";
import { resolveFxProviderName } from "./fx/index.js";
import { getProvider } from "./index.js";

delete process.env.DATABASE_URL;
process.env.TRACKFOLIO_DB = join(mkdtempSync(join(tmpdir(), "trackfolio-provider-")), "test.sqlite");

before(async () => {
  await initDb();
  await settingsRepo.load();
});

test("行情来源固定为自动", async () => {
  assert.equal(getProvider().name, "auto");
});

test("汇率来源默认自动，并跟随后台设置切换", async () => {
  await settingsRepo.updateDisplay({ exchange_rate_provider: "auto" });
  assert.equal(resolveFxProviderName(), "auto");

  await settingsRepo.updateDisplay({ exchange_rate_provider: "yahoo" });
  assert.equal(resolveFxProviderName(), "yahoo");
});
