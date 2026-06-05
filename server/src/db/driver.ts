import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 数据库驱动抽象：统一 SQLite（开发/单机默认）与 PostgreSQL（生产可选）。
 * 所有方法异步，SQL 用 `?` 占位（PostgreSQL 驱动内部转成 $1..$n）。
 */
export interface Driver {
  readonly dialect: "sqlite" | "postgres";
  all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(sql: string, params?: unknown[]): Promise<void>;
  /** 执行多语句 DDL（无参数）。 */
  exec(sql: string): Promise<void>;
  /** 在单个事务内执行 fn，fn 内部的 db 调用自动归入该事务。 */
  tx<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 是否启用 PostgreSQL：显式 DB_DRIVER=postgres，或提供了 DATABASE_URL。 */
export function usePostgres(): boolean {
  const driver = process.env.DB_DRIVER?.toLowerCase();
  if (driver === "postgres" || driver === "pg") return true;
  if (driver === "sqlite") return false;
  return !!process.env.DATABASE_URL;
}

/* ----------------------------- SQLite 驱动 ----------------------------- */

class SqliteDriver implements Driver {
  readonly dialect = "sqlite" as const;
  // node:sqlite 为同步 API，这里包装成 Promise 以统一接口。
  private raw: import("node:sqlite").DatabaseSync;

  private constructor(raw: import("node:sqlite").DatabaseSync) {
    this.raw = raw;
  }

  static async create(): Promise<SqliteDriver> {
    const { DatabaseSync } = await import("node:sqlite");
    const dbPath = process.env.TRACKFOLIO_DB ?? resolve(__dirname, "../../data/trackfolio.sqlite");
    mkdirSync(dirname(dbPath), { recursive: true });
    const raw = new DatabaseSync(dbPath);
    raw.exec("PRAGMA journal_mode = WAL");
    raw.exec("PRAGMA foreign_keys = ON");
    return new SqliteDriver(raw);
  }

  all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return Promise.resolve(this.raw.prepare(sql).all(...(params as never[])) as T[]);
  }

  get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return Promise.resolve(this.raw.prepare(sql).get(...(params as never[])) as T | undefined);
  }

  run(sql: string, params: unknown[] = []): Promise<void> {
    this.raw.prepare(sql).run(...(params as never[]));
    return Promise.resolve();
  }

  exec(sql: string): Promise<void> {
    this.raw.exec(sql);
    return Promise.resolve();
  }

  async tx<T>(fn: () => Promise<T>): Promise<T> {
    this.raw.exec("BEGIN");
    try {
      const result = await fn();
      this.raw.exec("COMMIT");
      return result;
    } catch (e) {
      this.raw.exec("ROLLBACK");
      throw e;
    }
  }

  close(): Promise<void> {
    this.raw.close();
    return Promise.resolve();
  }
}

/* --------------------------- PostgreSQL 驱动 --------------------------- */

/** 把 `?` 占位符转成 PostgreSQL 的 $1..$n。SQL 内不含字符串字面量里的 `?`。 */
function toPgPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

class PostgresDriver implements Driver {
  readonly dialect = "postgres" as const;
  // 单事务内把所有查询路由到同一个 client，保证原子性。
  private als = new AsyncLocalStorage<import("pg").PoolClient>();

  private constructor(private pool: import("pg").Pool) {}

  static async create(): Promise<PostgresDriver> {
    const pg = await import("pg");
    // node-postgres 默认把 numeric 当字符串返回；本项目金额用 double precision，无需特殊处理。
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX ?? 10),
      ssl: process.env.PGSSL === "require" ? { rejectUnauthorized: false } : undefined,
    });
    return new PostgresDriver(pool);
  }

  private async query<T>(sql: string, params: unknown[]): Promise<T[]> {
    const text = toPgPlaceholders(sql);
    const client = this.als.getStore();
    const res = client ? await client.query(text, params) : await this.pool.query(text, params);
    return res.rows as T[];
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.query<T>(sql, params);
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const rows = await this.query<T>(sql, params);
    return rows[0];
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    await this.query(sql, params);
  }

  async exec(sql: string): Promise<void> {
    const client = this.als.getStore();
    if (client) await client.query(sql);
    else await this.pool.query(sql);
  }

  async tx<T>(fn: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await this.als.run(client, async () => {
        await client.query("BEGIN");
        try {
          const result = await fn();
          await client.query("COMMIT");
          return result;
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        }
      });
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export async function createDriver(): Promise<Driver> {
  return usePostgres() ? PostgresDriver.create() : SqliteDriver.create();
}
