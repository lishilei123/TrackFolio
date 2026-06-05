import type { FastifyInstance } from "fastify";
import { createAssetSchema, defaultCurrencyFor, isValidSymbol } from "../domain/validate.js";
import { assetsRepo } from "../repositories/assets.js";
import { positionsRepo } from "../repositories/positions.js";
import { quotesRepo } from "../repositories/quotes.js";
import { refreshOne } from "../services/refresh.js";
import { requireUnlockedPreHandler } from "./authGuard.js";

export async function assetRoutes(app: FastifyInstance): Promise<void> {
  // 列出资产（带行情快照）
  app.get("/api/assets", async () => {
    const [assets, quotes] = await Promise.all([assetsRepo.list(), quotesRepo.all()]);
    const quoteByAsset = new Map(quotes.map((q) => [q.asset_id, q]));
    return assets.map((a) => ({ ...a, quote: quoteByAsset.get(a.id) ?? null }));
  });

  app.get("/api/assets/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const asset = await assetsRepo.get(id);
    if (!asset) return reply.code(404).send({ error: "资产不存在" });
    const [quote, positions] = await Promise.all([quotesRepo.get(id), positionsRepo.listByAsset(id)]);
    return { ...asset, quote, positions };
  });

  // 创建资产
  app.post("/api/assets", { preHandler: requireUnlockedPreHandler }, async (req, reply) => {
    const parsed = createAssetSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "参数校验失败", details: parsed.error.flatten() });
    }
    const body = parsed.data;

    // 单实例内 asset_type + market + symbol 不允许重复（需求 5.2）
    const dup = await assetsRepo.findByKey(body.asset_type, body.market, body.symbol);
    if (dup) {
      return reply.code(409).send({ error: "该资产已存在", asset: dup });
    }

    const currency = body.currency ?? defaultCurrencyFor(body.market);
    // 代码不符合格式但允许自定义 → 标记数据不可用（需求 5.2）
    const customUnavailable = !isValidSymbol(body.market, body.symbol);
    const asset = await assetsRepo.create({
      asset_type: body.asset_type,
      market: body.market,
      symbol: body.symbol,
      name: body.name,
      currency,
      exchange: body.exchange ?? null,
      fund_type: body.fund_type ?? (body.asset_type === "FUND" ? "otc" : null),
      quote_status: customUnavailable ? "unavailable" : "unavailable",
    });

    // 立即尝试拉取一次行情（失败不阻断创建）
    if (!customUnavailable) {
      await refreshOne(asset.id);
    }
    const fresh = (await assetsRepo.get(asset.id))!;
    return reply.code(201).send({ ...fresh, quote: await quotesRepo.get(fresh.id) });
  });

  // 删除资产（连带持仓 CASCADE）
  app.delete("/api/assets/:id", { preHandler: requireUnlockedPreHandler }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const asset = await assetsRepo.get(id);
    if (!asset) return reply.code(404).send({ error: "资产不存在" });
    await assetsRepo.remove(id);
    return reply.code(204).send();
  });
}
