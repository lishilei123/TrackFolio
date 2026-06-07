import { randomBytes, scryptSync } from "node:crypto";
import { createDriver, type Driver } from "./driver.js";

let active: Driver | null = null;

function driver(): Driver {
  if (!active) throw new Error("数据库尚未初始化，请先调用 initDb()");
  return active;
}

/**
 * 统一数据访问入口，底层为 SQLite 或 PostgreSQL（见 driver.ts）。
 * SQL 一律使用 `?` 占位符，PostgreSQL 会自动转换为 $1..$n。
 */
export const db = {
  all: <T = unknown>(sql: string, params?: unknown[]): Promise<T[]> => driver().all<T>(sql, params),
  get: <T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined> => driver().get<T>(sql, params),
  run: (sql: string, params?: unknown[]): Promise<void> => driver().run(sql, params),
  exec: (sql: string): Promise<void> => driver().exec(sql),
  tx: <T>(fn: () => Promise<T>): Promise<T> => driver().tx(fn),
  get dialect(): "sqlite" | "postgres" {
    return driver().dialect;
  },
};

/** 建表 —— 对应需求文档第 7 章数据模型。DDL 在 SQLite / PostgreSQL 下均可执行。 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS assets (
    id            TEXT PRIMARY KEY,
    asset_type    TEXT NOT NULL CHECK (asset_type IN ('STOCK','FUND')),
    market        TEXT NOT NULL CHECK (market IN ('CN','US','HK')),
    symbol        TEXT NOT NULL,
    name          TEXT NOT NULL,
    currency      TEXT NOT NULL CHECK (currency IN ('CNY','USD','HKD')),
    exchange      TEXT,
    fund_type     TEXT,
    quote_status  TEXT NOT NULL DEFAULT 'unavailable',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    UNIQUE (asset_type, market, symbol)
  );

  CREATE TABLE IF NOT EXISTS positions (
    id          TEXT PRIMARY KEY,
    asset_id    TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    quantity    DOUBLE PRECISION NOT NULL DEFAULT 0,
    avg_cost    DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_fee   DOUBLE PRECISION NOT NULL DEFAULT 0,
    opened_at   TEXT,
    closed_at   TEXT,
    tags        TEXT NOT NULL DEFAULT '[]',
    note        TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_positions_asset ON positions(asset_id);

  CREATE TABLE IF NOT EXISTS transactions (
    id           TEXT PRIMARY KEY,
    asset_id     TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    side         TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
    quantity     DOUBLE PRECISION NOT NULL,
    price        DOUBLE PRECISION NOT NULL,
    fee          DOUBLE PRECISION NOT NULL DEFAULT 0,
    currency     TEXT NOT NULL,
    trade_time   TEXT NOT NULL,
    external_key TEXT,
    note         TEXT,
    created_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS quote_snapshots (
    asset_id           TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
    latest_price       DOUBLE PRECISION,
    latest_nav         DOUBLE PRECISION,
    previous_close     DOUBLE PRECISION,
    pre_previous_close DOUBLE PRECISION,
    previous_nav       DOUBLE PRECISION,
    nav_date           TEXT,
    open               DOUBLE PRECISION,
    high               DOUBLE PRECISION,
    low                DOUBLE PRECISION,
    volume             DOUBLE PRECISION,
    change_amount      DOUBLE PRECISION,
    change_percent     DOUBLE PRECISION,
    market_status      TEXT NOT NULL DEFAULT 'unknown',
    quote_time         TEXT,
    provider           TEXT NOT NULL DEFAULT 'mock',
    status             TEXT NOT NULL DEFAULT 'unavailable'
  );

  CREATE TABLE IF NOT EXISTS exchange_rates (
    base_currency   TEXT NOT NULL,
    target_currency TEXT NOT NULL,
    rate            DOUBLE PRECISION NOT NULL,
    rate_time       TEXT NOT NULL,
    provider        TEXT NOT NULL,
    PRIMARY KEY (base_currency, target_currency)
  );

  CREATE TABLE IF NOT EXISTS display_settings (
    id                      INTEGER PRIMARY KEY CHECK (id = 1),
    settlement_currency     TEXT NOT NULL DEFAULT 'CNY',
    show_original_currency  INTEGER NOT NULL DEFAULT 1,
    exchange_rate_provider  TEXT NOT NULL DEFAULT 'mock',
    theme                   TEXT NOT NULL DEFAULT 'dark',
    quote_refresh_interval  INTEGER NOT NULL DEFAULT 30,
    pnl_color_scheme        TEXT NOT NULL DEFAULT 'green_up',
    pnl_up_color            TEXT NOT NULL DEFAULT '#62b889',
    pnl_down_color          TEXT NOT NULL DEFAULT '#d47777',
    pnl_flat_color          TEXT NOT NULL DEFAULT '#9aa2ad',
    custom_theme            TEXT,
    background_image        TEXT,
    background_dim          DOUBLE PRECISION NOT NULL DEFAULT 0.4,
    background_blur         INTEGER NOT NULL DEFAULT 0,
    updated_at              TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS security_settings (
    id                       INTEGER PRIMARY KEY CHECK (id = 1),
    position_password_enabled INTEGER NOT NULL DEFAULT 0,
    position_password_hash    TEXT,
    position_password_salt    TEXT,
    unlock_expires_at         TEXT,
    failed_attempt_count      INTEGER NOT NULL DEFAULT 0,
    locked_until              TEXT,
    updated_at                TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS daily_pnl (
    date              TEXT NOT NULL,
    asset_id          TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    market            TEXT NOT NULL,
    asset_type        TEXT NOT NULL,
    quantity          DOUBLE PRECISION NOT NULL,
    close_price       DOUBLE PRECISION,
    nav               DOUBLE PRECISION,
    daily_pnl_amount  DOUBLE PRECISION,
    total_pnl_amount  DOUBLE PRECISION,
    currency          TEXT NOT NULL,
    is_estimated      INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL,
    PRIMARY KEY (date, asset_id)
  );
  CREATE INDEX IF NOT EXISTS idx_daily_pnl_date ON daily_pnl(date);
`;

/** 初始化数据库连接、建表、写入种子数据。应用启动时调用一次。 */
export async function initDb(): Promise<void> {
  active = await createDriver();
  await active.exec(SCHEMA);
  await migrate();
  await seedDefaults();
}

/**
 * 轻量迁移：为既有数据库补充后续新增的列。
 * SQLite 不支持 ADD COLUMN IF NOT EXISTS，统一用 try/catch 保证幂等。
 */
async function migrate(): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const addColumns: Array<[string, string]> = [
    // 涨跌配色方案：green_up（绿涨红跌，终端风格）/ red_up（红涨绿跌，A 股习惯）
    ["display_settings", "pnl_color_scheme TEXT NOT NULL DEFAULT 'green_up'"],
    ["display_settings", "pnl_up_color TEXT NOT NULL DEFAULT '#62b889'"],
    ["display_settings", "pnl_down_color TEXT NOT NULL DEFAULT '#d47777'"],
    ["display_settings", "pnl_flat_color TEXT NOT NULL DEFAULT '#9aa2ad'"],
    // 自定义主题：存 JSON（base + 6 个基础色），theme = 'custom' 时生效
    ["display_settings", "custom_theme TEXT"],
    // 自定义背景图：base64 data URL + 暗度遮罩(0~1) + 模糊(px)
    ["display_settings", "background_image TEXT"],
    ["display_settings", "background_dim DOUBLE PRECISION NOT NULL DEFAULT 0.4"],
    ["display_settings", "background_blur INTEGER NOT NULL DEFAULT 0"],
  ];
  for (const [table, column] of addColumns) {
    try {
      await db.run(`ALTER TABLE ${table} ADD COLUMN ${column}`);
    } catch {
      /* 列已存在，忽略 */
    }
  }
}

function adminPasswordSeed(): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: scryptSync("admin", salt, 64).toString("hex") };
}

async function seedDefaults(): Promise<void> {
  const now = new Date().toISOString();

  const hasSetting = await db.get("SELECT 1 AS one FROM display_settings WHERE id = 1");
  if (!hasSetting) {
    await db.run(`INSERT INTO display_settings (id, updated_at) VALUES (1, ?)`, [now]);
  }

  const security = await db.get<{ position_password_hash: string | null; position_password_salt: string | null }>(
    "SELECT position_password_hash, position_password_salt FROM security_settings WHERE id = 1",
  );
  if (!security) {
    const seed = adminPasswordSeed();
    await db.run(
      `INSERT INTO security_settings
         (id, position_password_enabled, position_password_hash, position_password_salt, updated_at)
       VALUES (1, 1, ?, ?, ?)`,
      [seed.hash, seed.salt, now],
    );
  } else if (!security.position_password_hash || !security.position_password_salt) {
    const seed = adminPasswordSeed();
    await db.run(
      `UPDATE security_settings
         SET position_password_enabled = 1,
             position_password_hash = ?,
             position_password_salt = ?,
             updated_at = ?
       WHERE id = 1`,
      [seed.hash, seed.salt, now],
    );
  }

  // 种子汇率（mock）。真实汇率由 ExchangeRate Provider 后续接入。
  const rateCount = await db.get<{ c: number }>("SELECT COUNT(*) AS c FROM exchange_rates");
  if (!rateCount || Number(rateCount.c) === 0) {
    const seedRates: Array<[string, string, number]> = [
      ["USD", "CNY", 7.25],
      ["HKD", "CNY", 0.93],
      ["CNY", "USD", 1 / 7.25],
      ["HKD", "USD", 0.128],
      ["CNY", "HKD", 1 / 0.93],
      ["USD", "HKD", 7.8],
      ["CNY", "CNY", 1],
      ["USD", "USD", 1],
      ["HKD", "HKD", 1],
    ];
    await db.tx(async () => {
      for (const [base, target, rate] of seedRates) {
        await db.run(
          `INSERT INTO exchange_rates (base_currency, target_currency, rate, rate_time, provider)
           VALUES (?, ?, ?, ?, 'mock')`,
          [base, target, rate, now],
        );
      }
    });
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}
