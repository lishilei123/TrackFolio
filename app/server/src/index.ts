import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyReply } from "fastify";
import { initDb } from "./db/index.js";
import { ASSET_TYPES, CURRENCIES, DEFAULT_CURRENCY, MARKETS } from "./domain/types.js";
import { getProvider } from "./providers/index.js";
import { dailyPnlRepo } from "./repositories/dailyPnl.js";
import { settingsRepo } from "./repositories/settings.js";
import { fxService } from "./services/fx.js";
import { adminRoutes } from "./routes/admin.js";
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

app.get("/api/health", async () => ({ status: "ok", provider: getProvider().name }));

// 前端用的元数据：市场、币种、资产类型、默认币种
app.get("/api/meta", async () => ({
  asset_types: ASSET_TYPES,
  markets: MARKETS,
  currencies: CURRENCIES,
  default_currency: DEFAULT_CURRENCY,
  provider: getProvider().name,
}));

await app.register(adminRoutes);
await app.register(assetRoutes);
await app.register(positionRoutes);
await app.register(transactionRoutes);
await app.register(portfolioRoutes);
await app.register(settingsRoutes);
await app.register(historyRoutes);
await app.register(searchRoutes);

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "../../web/dist");

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

async function sendFileIfExists(filePath: string, method: string, reply: FastifyReply): Promise<boolean> {
  let info;
  try {
    info = await stat(filePath);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;

  reply.type(MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream");
  reply.header("Content-Length", info.size);
  if (method === "HEAD") reply.send();
  else reply.send(createReadStream(filePath));
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
  if (filePath && (await sendFileIfExists(filePath, req.method, reply))) return reply;
  if (!extname(pathname) && (await sendFileIfExists(join(WEB_ROOT, "index.html"), req.method, reply))) return reply;
  return reply.status(404).send({ error: "Not Found" });
});

// 服务端后台自动刷新（需求 5.4：自动刷新间隔可配置）
let refreshTimer: NodeJS.Timeout | null = null;
function scheduleRefresh(): void {
  if (refreshTimer) clearInterval(refreshTimer);
  const interval = settingsRepo.getDisplay().quote_refresh_interval * 1000;
  refreshTimer = setInterval(() => {
    refreshAll().catch((err) => app.log.error(err, "background refresh failed"));
  }, interval);
}

// 定投「待确认」占位回填：每 6 小时扫描一次，净值披露后自动折算补录为正式流水
const SIP_FILL_INTERVAL_MS = 6 * 3_600_000;
function runSipFill(): void {
  fillPendingSipOrders()
    .then((s) => {
      if (s.confirmed || s.expired || s.failed) {
        app.log.info(
          `sip fill: confirmed=${s.confirmed} pending=${s.stillPending} expired=${s.expired} failed=${s.failed}`,
        );
      }
    })
    .catch((err) => app.log.error(err, "sip pending fill failed"));
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
