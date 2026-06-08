import type { FastifyInstance } from "fastify";
import type { Asset, AssetType, Market } from "../domain/types.js";
import { ASSET_TYPES, MARKETS } from "../domain/types.js";
import { getProvider } from "../providers/index.js";
import { requireUnlockedPreHandler } from "./authGuard.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  // 搜索标的（代码 / 名称 / 拼音），用于添加资产（需求 5.2）
  app.get("/api/search", { preHandler: requireUnlockedPreHandler }, async (req) => {
    const q = (req.query as { q?: string })?.q ?? "";
    const marketRaw = (req.query as { market?: string })?.market;
    const typeRaw = (req.query as { type?: string })?.type;
    const market = MARKETS.includes(marketRaw as Market) ? (marketRaw as Market) : undefined;
    const asset_type = ASSET_TYPES.includes(typeRaw as AssetType) ? (typeRaw as AssetType) : undefined;

    const provider = getProvider();
    if (!provider.search || !q.trim()) return { results: [] };
    const results = await provider.search(q, { market, asset_type, limit: 20 });
    return { results };
  });

  // 场外基金历史单位净值（按代码 + 日期区间），用于基金定投批量补录时自动填净值
  app.get("/api/fund-nav-history", { preHandler: requireUnlockedPreHandler }, async (req, reply) => {
    const q = req.query as { symbol?: string; from?: string; to?: string };
    const symbol = (q.symbol ?? "").trim();
    if (!/^\d{6}$/.test(symbol)) return reply.code(400).send({ error: "无效的基金代码" });

    const provider = getProvider();
    if (typeof provider.fetchHistory !== "function") return { points: [] };

    const today = new Date().toISOString().slice(0, 10);
    const from = q.from && DATE_RE.test(q.from) ? q.from : null;
    const to = q.to && DATE_RE.test(q.to) ? q.to : today;

    // 历史接口按记录数取，over-fetch 无害；用自然日跨度估算并加护栏上限
    let days = 400;
    if (from) {
      const span = Math.ceil((Date.parse(to) - Date.parse(from)) / 86_400_000) + 10;
      days = Math.min(Math.max(span, 10), 4000);
    }

    const transient: Asset = {
      id: "",
      asset_type: "FUND",
      market: "CN",
      symbol,
      name: "",
      currency: "CNY",
      exchange: null,
      fund_type: "otc",
      quote_status: "ok",
      created_at: "",
      updated_at: "",
    };

    const res = await provider.fetchHistory(transient, days);
    if (!res.ok) return { points: [] };
    const points = from ? res.data.filter((p) => p.date >= from && p.date <= to) : res.data;
    return { points };
  });
}
