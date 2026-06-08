import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db, nowIso } from "../db/index.js";
import { initialAdminPassword } from "../security/adminPassword.js";

const ADMIN_UNLOCK_TTL_MINUTES = 30;
const DEFAULT_MAX_FAILED_ATTEMPTS = 5;
const DEFAULT_LOCK_MINUTES = 15;

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
  token?: string;
}

export interface AdminLockStatus {
  locked: boolean;
  locked_until: string | null;
  failed_attempt_count: number;
}

interface AdminSessionRow {
  token_hash: string;
  expires_at: string;
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

function newToken(): string {
  return randomBytes(32).toString("hex");
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function defaultCredentials(): { salt: string; hash: string } {
  const salt = newSalt();
  return { salt, hash: hashPassword(initialAdminPassword(), salt) };
}

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function maxFailedAttempts(): number {
  return envInt("TRACKFOLIO_ADMIN_MAX_FAILED_ATTEMPTS", DEFAULT_MAX_FAILED_ATTEMPTS);
}

function lockMinutes(): number {
  return envInt("TRACKFOLIO_ADMIN_LOCK_MINUTES", DEFAULT_LOCK_MINUTES);
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

  async session(token?: string | null): Promise<AdminSession> {
    if (!token) return { unlocked: false, unlock_expires_at: null };

    await db.run("DELETE FROM admin_sessions WHERE expires_at <= ?", [nowIso()]);
    const row = await db.get<AdminSessionRow>("SELECT token_hash, expires_at FROM admin_sessions WHERE token_hash = ?", [
      tokenHash(token),
    ]);
    const unlocked = row != null && Date.parse(row.expires_at) > Date.now();
    return { unlocked, unlock_expires_at: unlocked ? row.expires_at : null };
  },

  async isUnlocked(token?: string | null): Promise<boolean> {
    return (await this.session(token)).unlocked;
  },

  async verifyPassword(password: string): Promise<boolean> {
    const row = await this.get();
    if (!row.position_password_hash || !row.position_password_salt) return false;
    const hash = hashPassword(password, row.position_password_salt);
    return safeEqualHex(hash, row.position_password_hash);
  },

  async isLocked(): Promise<AdminLockStatus> {
    const row = await this.get();
    const locked = row.locked_until != null && Date.parse(row.locked_until) > Date.now();
    if (locked) {
      return {
        locked: true,
        locked_until: row.locked_until,
        failed_attempt_count: row.failed_attempt_count,
      };
    }

    if (row.locked_until != null) {
      await db.run(
        `UPDATE security_settings
           SET failed_attempt_count = 0, locked_until = NULL, updated_at = ?
         WHERE id = 1`,
        [nowIso()],
      );
      return { locked: false, locked_until: null, failed_attempt_count: 0 };
    }

    return { locked: false, locked_until: null, failed_attempt_count: row.failed_attempt_count };
  },

  async unlock(minutes = ADMIN_UNLOCK_TTL_MINUTES): Promise<AdminSession> {
    const token = newToken();
    const expires = futureIso(minutes);
    const now = nowIso();
    await db.tx(async () => {
      await db.run("DELETE FROM admin_sessions", []);
      await db.run(
        `INSERT INTO admin_sessions (token_hash, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
        [tokenHash(token), expires, now, now],
      );
      await db.run(
        `UPDATE security_settings
           SET unlock_expires_at = NULL, failed_attempt_count = 0, locked_until = NULL, updated_at = ?
         WHERE id = 1`,
        [now],
      );
    });
    return { unlocked: true, unlock_expires_at: expires, token };
  },

  async lock(token?: string | null): Promise<AdminSession> {
    if (token) {
      await db.run("DELETE FROM admin_sessions WHERE token_hash = ?", [tokenHash(token)]);
    }
    await db.run(
      `UPDATE security_settings
         SET unlock_expires_at = NULL, updated_at = ?
       WHERE id = 1`,
      [nowIso()],
    );
    return { unlocked: false, unlock_expires_at: null };
  },

  async recordFailedAttempt(): Promise<AdminLockStatus> {
    const row = await this.get();
    const failed = row.failed_attempt_count + 1;
    const lockedUntil = failed >= maxFailedAttempts() ? futureIso(lockMinutes()) : null;
    await db.run(
      `UPDATE security_settings
         SET failed_attempt_count = ?, locked_until = ?, updated_at = ?
       WHERE id = 1`,
      [failed, lockedUntil, nowIso()],
    );
    return { locked: lockedUntil != null, locked_until: lockedUntil, failed_attempt_count: failed };
  },

  async setPassword(password: string): Promise<void> {
    const salt = newSalt();
    const finalHash = hashPassword(password, salt);
    await db.tx(async () => {
      await db.run(
        `UPDATE security_settings
           SET position_password_enabled = 1,
               position_password_hash = ?,
               position_password_salt = ?,
               failed_attempt_count = 0,
               locked_until = NULL,
               unlock_expires_at = NULL,
               updated_at = ?
         WHERE id = 1`,
        [finalHash, salt, nowIso()],
      );
      await db.run("DELETE FROM admin_sessions");
    });
  },
};
