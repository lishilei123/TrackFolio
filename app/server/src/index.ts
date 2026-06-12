import type { Stats } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { brotliCompress, constants as zlibConstants, gzip } from "node:zlib";
import compress from "@fastify/compress";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { initDb } from "./db/index.js";
import { ASSET_TYPES, CURRENCIES, DEFAULT_CURRENCY, MARKETS } from "./domain/types.js";
import { getProvider } from "./providers/index.js";
import { dailyPnlRepo } from "./repositories/dailyPnl.js";
import { settingsRepo } from "./repositories/settings.js";
import { fxService } from "./services/fx.js";
import { adminRoutes } from "./routes/admin.js";
import { allocationRoutes } from "./routes/allocation.js";
import { assetRoutes } from "./routes/assets.js";
import { historyRoutes } from "./routes/history.js";
import { portfolioRoutes } from "./routes/portfolio.js";
import { positionRoutes } from "./routes/positions.js";
import { searchRoutes } from "./routes/search.js";
import { settingsRoutes } from "./routes/settings.js";
import { transactionRoutes } from "./routes/transactions.js";
import { backfillHistory, pruneInvalidDailyPnlRows } from "./services/history.js";
import { refreshAll } from "./services/refresh.js";
import { fillPendingSipOrders } from "./services/sipFill.js";

// 初始化数据库（SQLite 或 PostgreSQL）并预热内存缓存（显示设置 / 汇率）
await initDb();
await settingsRepo.load();
await fxService.loadCache();

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

await app.register(compress, {
  global: true,
  threshold: 1024,
});

app.get("/api/health", async () => ({ status: "ok", provider: getProvider().name }));

// 前端用的元数据：市场、币种、资产类型、默认币种
app.get("/api/meta", async (req, reply) => {
  const body = {
    asset_types: ASSET_TYPES,
    markets: MARKETS,
    currencies: CURRENCIES,
    default_currency: DEFAULT_CURRENCY,
    provider: getProvider().name,
  };
  const etag = `W/"meta-${body.provider}"`;
  reply.header("Cache-Control", "public, max-age=3600");
  reply.header("ETag", etag);
  if (clientHasFreshEtag(req, etag)) return reply.status(304).send();
  return body;
});

await app.register(adminRoutes);
await app.register(assetRoutes);
await app.register(allocationRoutes);
await app.register(positionRoutes);
await app.register(transactionRoutes);
await app.register(portfolioRoutes);
await app.register(settingsRoutes);
await app.register(historyRoutes);
await app.register(searchRoutes);

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "../../web/dist");
const brotli = promisify(brotliCompress);
const gzipBuffer = promisify(gzip);
type StaticEncoding = "br" | "gzip";
const compressedStaticCache = new Map<string, { etag: string; body: Buffer }>();

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function requestPathname(url: string): string | null {
  try {
    return new URL(url, "http://trackfolio.local").pathname;
  } catch {
    return null;
  }
}

function safeStaticPath(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const requested = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const candidate = resolve(WEB_ROOT, requested);
  const rel = relative(WEB_ROOT, candidate);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return candidate;
}

function headerText(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value.join(",");
  return value ?? null;
}

function entityTag(info: Stats): string {
  return `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
}

function clientHasFreshEtag(req: FastifyRequest, etag: string): boolean {
  const ifNoneMatch = headerText(req.headers["if-none-match"]);
  if (!ifNoneMatch) return false;
  const candidates = ifNoneMatch.split(",").map((value) => value.trim());
  return candidates.includes("*") || candidates.includes(etag);
}

function clientHasFreshFile(req: FastifyRequest, etag: string, lastModified: string): boolean {
  const ifNoneMatch = headerText(req.headers["if-none-match"]);
  if (ifNoneMatch) {
    const candidates = ifNoneMatch.split(",").map((value) => value.trim());
    return candidates.includes("*") || candidates.includes(etag);
  }

  const ifModifiedSince = headerText(req.headers["if-modified-since"]);
  if (!ifModifiedSince) return false;
  const since = Date.parse(ifModifiedSince);
  const modified = Date.parse(lastModified);
  return Number.isFinite(since) && Number.isFinite(modified) && modified <= since;
}

function staticCacheControl(pathname: string, filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".html" || pathname === "/" || !extname(pathname)) return "no-cache";
  if (pathname.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  if ([".gif", ".ico", ".jpg", ".jpeg", ".png", ".svg", ".webp", ".woff", ".woff2"].includes(ext)) {
    return "public, max-age=86400";
  }
  return "no-cache";
}

function setVaryAcceptEncoding(reply: FastifyReply): void {
  const current = reply.getHeader("Vary");
  const text = Array.isArray(current) ? current.join(", ") : current ? String(current) : "";
  const values = text
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (!values.includes("accept-encoding")) {
    reply.header("Vary", text ? `${text}, Accept-Encoding` : "Accept-Encoding");
  }
}

function acceptsEncoding(accept: string, encoding: string): boolean {
  for (const part of accept.split(",")) {
    const [name, ...params] = part.split(";").map((value) => value.trim().toLowerCase());
    if (name !== encoding && name !== "*") continue;
    const qParam = params.find((param) => param.startsWith("q="));
    const q = qParam ? Number(qParam.slice(2)) : 1;
    if (Number.isFinite(q) && q > 0) return true;
  }
  return false;
}

function preferredStaticEncoding(req: FastifyRequest): StaticEncoding | null {
  const accept = headerText(req.headers["accept-encoding"])?.toLowerCase();
  if (!accept) return null;
  if (acceptsEncoding(accept, "br")) return "br";
  if (acceptsEncoding(accept, "gzip")) return "gzip";
  return null;
}

function isCompressibleStatic(filePath: string): boolean {
  return [".css", ".html", ".js", ".json", ".svg", ".txt"].includes(extname(filePath).toLowerCase());
}

async function staticBody(
  filePath: string,
  req: FastifyRequest,
  etag: string,
  size: number,
): Promise<{ body: Buffer; encoding: StaticEncoding | null }> {
  if (size < 1024 || !isCompressibleStatic(filePath)) return { body: await readFile(filePath), encoding: null };
  const encoding = preferredStaticEncoding(req);
  if (!encoding) return { body: await readFile(filePath), encoding: null };

  const cacheKey = `${filePath}:${encoding}`;
  const cached = compressedStaticCache.get(cacheKey);
  if (cached?.etag === etag) return { body: cached.body, encoding };

  const body = await readFile(filePath);
  const compressed =
    encoding === "br"
      ? await brotli(body, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } })
      : await gzipBuffer(body, { level: 6 });
  compressedStaticCache.set(cacheKey, { etag, body: compressed });
  return { body: compressed, encoding };
}

async function sendFileIfExists(
  filePath: string,
  method: string,
  reply: FastifyReply,
  req: FastifyRequest,
  pathname: string,
): Promise<boolean> {
  let info;
  try {
    info = await stat(filePath);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;

  const lastModified = info.mtime.toUTCString();
  const etag = entityTag(info);
  reply.header("Cache-Control", staticCacheControl(pathname, filePath));
  reply.header("ETag", etag);
  reply.header("Last-Modified", lastModified);

  if (clientHasFreshFile(req, etag, lastModified)) {
    reply.status(304).send();
    return true;
  }

  reply.type(MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream");
  if (method === "HEAD") reply.send();
  else {
    const { body, encoding } = await staticBody(filePath, req, etag, info.size);
    if (encoding) {
      reply.header("Content-Encoding", encoding);
      setVaryAcceptEncoding(reply);
    }
    reply.send(body);
  }
  return true;
}

app.setNotFoundHandler(async (req, reply) => {
  const pathname = requestPathname(req.url);
  if (!pathname || pathname === "/api" || pathname.startsWith("/api/")) {
    return reply.status(404).send({ error: "Not Found" });
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return reply.status(404).send({ error: "Not Found" });
  }

  const filePath = safeStaticPath(pathname);
  if (filePath && (await sendFileIfExists(filePath, req.method, reply, req, pathname))) return reply;
  if (!extname(pathname) && (await sendFileIfExists(join(WEB_ROOT, "index.html"), req.method, reply, req, pathname))) {
    return reply;
  }
  return reply.status(404).send({ error: "Not Found" });
});

// 服务端后台自动刷新（需求 5.4：自动刷新间隔可配置）
// 用自调度 setTimeout 而非 setInterval：每轮跑完才排下一轮，
// 避免单轮刷新耗时超过间隔时多轮叠加；in-flight 标记再加一层兜底。
let refreshTimer: NodeJS.Timeout | null = null;
let refreshInFlight = false;
function scheduleRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  const interval = settingsRepo.getDisplay().quote_refresh_interval * 1000;
  refreshTimer = setTimeout(async function tick() {
    if (!refreshInFlight) {
      refreshInFlight = true;
      try {
        await refreshAll();
      } catch (err) {
        app.log.error(err, "background refresh failed");
      } finally {
        refreshInFlight = false;
      }
    }
    const next = settingsRepo.getDisplay().quote_refresh_interval * 1000;
    refreshTimer = setTimeout(tick, next);
  }, interval);
}

settingsRepo.onDisplayUpdated((display, previous) => {
  if (display.quote_refresh_interval !== previous.quote_refresh_interval) scheduleRefresh();
});

// 定投「待确认」占位回填：每 6 小时扫描一次，净值披露后自动折算补录为正式流水
const SIP_FILL_INTERVAL_MS = 6 * 3_600_000;
let sipFillInFlight = false;
function runSipFill(): void {
  if (sipFillInFlight) return; // 上一轮回填未结束时跳过，避免重叠
  sipFillInFlight = true;
  fillPendingSipOrders()
    .then((s) => {
      if (s.confirmed || s.expired || s.failed) {
        app.log.info(
          `sip fill: confirmed=${s.confirmed} pending=${s.stillPending} expired=${s.expired} failed=${s.failed}`,
        );
      }
    })
    .catch((err) => app.log.error(err, "sip pending fill failed"))
    .finally(() => {
      sipFillInFlight = false;
    });
}
function scheduleSipFill(): void {
  setInterval(runSipFill, SIP_FILL_INTERVAL_MS);
}

const PORT = Number(process.env.PORT ?? 5174);
try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`TrackFolio server listening on :${PORT}`);
  await refreshAll().catch(() => undefined); // 启动即拉一次（内部已写今日快照）
  await pruneInvalidDailyPnlRows().catch(() => undefined);
  // 全新库无历史 → 由 Provider 回填合成历史，保证曲线立即可看（需求 5.5.4）
  if (!(await dailyPnlRepo.hasAny())) {
    await backfillHistory(90)
      .then((r) => app.log.info(`backfilled history: ${r.rows} rows / ${r.assets} assets`))
      .catch((err) => app.log.error(err, "history backfill failed"));
  }
  scheduleRefresh();
  runSipFill(); // 启动即尝试回填一次
  scheduleSipFill();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
