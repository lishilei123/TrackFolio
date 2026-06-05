import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db, nowIso } from "../db/index.js";

const DEFAULT_ADMIN_PASSWORD = "admin";
const ADMIN_UNLOCK_TTL_MINUTES = 30;

interface SecurityRow {
  id: number;
  position_password_enabled: number;
  position_password_hash: string | null;
  position_password_salt: string | null;
  unlock_expires_at: string | null;
  failed_attempt_count: number;
  locked_until: string | null;
  updated_at: string;
}

export interface AdminSession {
  unlocked: boolean;
  unlock_expires_at: string | null;
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

function newSalt(): string {
  return randomBytes(16).toString("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function defaultCredentials(): { salt: string; hash: string } {
  const salt = newSalt();
  return { salt, hash: hashPassword(DEFAULT_ADMIN_PASSWORD, salt) };
}

function futureIso(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export const securityRepo = {
  async get(): Promise<SecurityRow> {
    const row = await db.get<SecurityRow>("SELECT * FROM security_settings WHERE id = 1");
    if (row) return row;

    const now = nowIso();
    const { salt, hash } = defaultCredentials();
    await db.run(
      `INSERT INTO security_settings
         (id, position_password_enabled, position_password_hash, position_password_salt,
          unlock_expires_at, failed_attempt_count, locked_until, updated_at)
       VALUES (1, 1, ?, ?, NULL, 0, NULL, ?)`,
      [hash, salt, now],
    );
    return this.get();
  },

  async ensureDefaultAdminPassword(): Promise<void> {
    const row = await this.get();
    if (row.position_password_hash && row.position_password_salt) return;
    const { salt, hash } = defaultCredentials();
    await db.run(
      `UPDATE security_settings
         SET position_password_enabled = 1,
             position_password_hash = ?,
             position_password_salt = ?,
             updated_at = ?
       WHERE id = 1`,
      [hash, salt, nowIso()],
    );
  },

  async session(): Promise<AdminSession> {
    const row = await this.get();
    const unlocked = row.unlock_expires_at != null && Date.parse(row.unlock_expires_at) > Date.now();
    return { unlocked, unlock_expires_at: unlocked ? row.unlock_expires_at : null };
  },

  async isUnlocked(): Promise<boolean> {
    return (await this.session()).unlocked;
  },

  async verifyPassword(password: string): Promise<boolean> {
    const row = await this.get();
    if (!row.position_password_hash || !row.position_password_salt) return false;
    const hash = hashPassword(password, row.position_password_salt);
    return safeEqualHex(hash, row.position_password_hash);
  },

  async unlock(minutes = ADMIN_UNLOCK_TTL_MINUTES): Promise<AdminSession> {
    const expires = futureIso(minutes);
    await db.run(
      `UPDATE security_settings
         SET unlock_expires_at = ?, failed_attempt_count = 0, locked_until = NULL, updated_at = ?
       WHERE id = 1`,
      [expires, nowIso()],
    );
    return this.session();
  },

  async lock(): Promise<AdminSession> {
    await db.run(
      `UPDATE security_settings
         SET unlock_expires_at = NULL, updated_at = ?
       WHERE id = 1`,
      [nowIso()],
    );
    return this.session();
  },

  async recordFailedAttempt(): Promise<void> {
    await db.run(
      `UPDATE security_settings
         SET failed_attempt_count = failed_attempt_count + 1, updated_at = ?
       WHERE id = 1`,
      [nowIso()],
    );
  },

  async setPassword(password: string): Promise<void> {
    const salt = newSalt();
    const finalHash = hashPassword(password, salt);
    await db.run(
      `UPDATE security_settings
         SET position_password_enabled = 1,
             position_password_hash = ?,
             position_password_salt = ?,
             updated_at = ?
       WHERE id = 1`,
      [finalHash, salt, nowIso()],
    );
  },
};
