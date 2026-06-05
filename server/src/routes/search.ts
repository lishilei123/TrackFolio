import type { FastifyInstance } from "fastify";
import type { AssetType, Market } from "../domain/types.js";
import { ASSET_TYPES, MARKETS } from "../domain/types.js";
import { getProvider } from "../providers/index.js";

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  // 搜索标的（代码 / 名称 / 拼音），用于添加资产（需求 5.2）
  app.get("/api/search", async (req) => {
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
}
