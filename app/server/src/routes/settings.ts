import type { FastifyInstance } from "fastify";
import { CURRENCIES } from "../domain/types.js";
import { updateDisplaySchema } from "../domain/validate.js";
import { settingsRepo } from "../repositories/settings.js";
import { fxService } from "../services/fx.js";
import { requireUnlockedPreHandler } from "./authGuard.js";

function headerText(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value.join(",");
  return value ?? null;
}

function clientHasFreshEtag(value: string | string[] | undefined, etag: string): boolean {
  const text = headerText(value);
  if (!text) return false;
  const candidates = text.split(",").map((item) => item.trim());
  return candidates.includes("*") || candidates.includes(etag);
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/settings/display", async (req, reply) => {
    const display = settingsRepo.getDisplay();
    const etag = `W/"display-${display.updated_at}"`;
    reply.header("Cache-Control", "private, no-cache");
    reply.header("ETag", etag);
    if (clientHasFreshEtag(req.headers["if-none-match"], etag)) return reply.code(304).send();
    return display;
  });

  app.patch("/api/settings/display", { preHandler: requireUnlockedPreHandler }, async (req, reply) => {
    const parsed = updateDisplaySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "参数校验失败", details: parsed.error.flatten() });
    }
    return settingsRepo.updateDisplay(parsed.data);
  });

  // 汇率（含来源与更新时间，需求 5.6）
  app.get("/api/fx", { preHandler: requireUnlockedPreHandler }, async (req, reply) => {
    const fallback = settingsRepo.getDisplay().settlement_currency;
    const rawTarget = (req.query as { target?: string })?.target ?? fallback;
    if (!CURRENCIES.includes(rawTarget as (typeof CURRENCIES)[number])) {
      return reply.code(400).send({ error: "不支持的目标币种" });
    }
    const target = rawTarget as (typeof CURRENCIES)[number];
    const status = fxService.getStatus();
    return { target, ...status, rates: fxService.listRates(target) };
  });

  app.post("/api/fx/refresh", { preHandler: requireUnlockedPreHandler }, async () => fxService.refreshRates());
}
