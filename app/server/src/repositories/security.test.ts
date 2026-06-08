import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, beforeEach, test } from "node:test";
import { db, initDb, nowIso } from "../db/index.js";
import { securityRepo } from "./security.js";

process.env.DB_DRIVER = "sqlite";
process.env.TRACKFOLIO_DB = join(mkdtempSync(join(tmpdir(), "trackfolio-security-")), "test.sqlite");
process.env.TRACKFOLIO_ADMIN_MAX_FAILED_ATTEMPTS = "2";
process.env.TRACKFOLIO_ADMIN_LOCK_MINUTES = "15";

before(async () => {
  await initDb();
});

beforeEach(async () => {
  await db.run("DELETE FROM admin_sessions");
  await db.run(
    `UPDATE security_settings
       SET failed_attempt_count = 0,
           locked_until = NULL,
           unlock_expires_at = NULL,
           updated_at = ?
     WHERE id = 1`,
    [nowIso()],
  );
  await securityRepo.setPassword("admin");
});

test("后台解锁返回当前浏览器 token，只有有效 token 会话为 unlocked", async () => {
  const unlocked = await securityRepo.unlock();

  assert.equal(typeof unlocked.token, "string");
  assert.equal((await securityRepo.session(unlocked.token)).unlocked, true);
  assert.equal((await securityRepo.session()).unlocked, false);
  assert.equal((await securityRepo.session("bad-token")).unlocked, false);
});

test("再次解锁会撤销旧浏览器 token", async () => {
  const first = await securityRepo.unlock();
  const second = await securityRepo.unlock();

  assert.equal((await securityRepo.session(first.token)).unlocked, false);
  assert.equal((await securityRepo.session(second.token)).unlocked, true);
});

test("锁定当前 token 后会话失效", async () => {
  const unlocked = await securityRepo.unlock();

  await securityRepo.lock(unlocked.token);

  assert.equal((await securityRepo.session(unlocked.token)).unlocked, false);
});

test("连续密码错误达到阈值后临时锁定", async () => {
  const first = await securityRepo.recordFailedAttempt();
  assert.equal(first.locked, false);
  assert.equal(first.failed_attempt_count, 1);

  const second = await securityRepo.recordFailedAttempt();
  assert.equal(second.locked, true);
  assert.equal(second.failed_attempt_count, 2);
  assert.ok(second.locked_until);

  const locked = await securityRepo.isLocked();
  assert.equal(locked.locked, true);
});

test("锁定过期后自动清除失败次数", async () => {
  await securityRepo.recordFailedAttempt();
  await securityRepo.recordFailedAttempt();
  await db.run(
    `UPDATE security_settings
       SET locked_until = ?, updated_at = ?
     WHERE id = 1`,
    ["2000-01-01T00:00:00.000Z", nowIso()],
  );

  const status = await securityRepo.isLocked();

  assert.equal(status.locked, false);
  assert.equal(status.failed_attempt_count, 0);
});

test("成功解锁会清空失败次数和锁定状态", async () => {
  await securityRepo.recordFailedAttempt();

  await securityRepo.unlock();
  const status = await securityRepo.isLocked();

  assert.equal(status.locked, false);
  assert.equal(status.failed_attempt_count, 0);
});

test("修改密码会更新 hash 并撤销所有后台 session", async () => {
  const unlocked = await securityRepo.unlock();

  await securityRepo.setPassword("new-pass");

  assert.equal(await securityRepo.verifyPassword("admin"), false);
  assert.equal(await securityRepo.verifyPassword("new-pass"), true);
  assert.equal((await securityRepo.session(unlocked.token)).unlocked, false);
});
