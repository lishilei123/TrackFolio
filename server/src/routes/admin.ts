import type { FastifyInstance } from "fastify";
import { adminChangePasswordSchema, adminUnlockSchema, updateDisplaySchema } from "../domain/validate.js";
import { securityRepo } from "../repositories/security.js";
import { settingsRepo } from "../repositories/settings.js";
import { adminTokenFromRequest, requireAllowedOriginPreHandler, requireUnlockedPreHandler } from "./authGuard.js";

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/admin/session", async (req) => securityRepo.session(adminTokenFromRequest(req)));

  app.post("/api/admin/unlock", { preHandler: requireAllowedOriginPreHandler }, async (req, reply) => {
    const parsed = adminUnlockSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "参数校验失败", details: parsed.error.flatten() });
    }

    const locked = await securityRepo.isLocked();
    if (locked.locked) {
      return reply.code(423).send({ error: "后台已临时锁定，请稍后再试", locked_until: locked.locked_until });
    }

    if (!(await securityRepo.verifyPassword(parsed.data.password))) {
      const failed = await securityRepo.recordFailedAttempt();
      if (failed.locked) {
        return reply.code(423).send({ error: "密码错误次数过多，请稍后再试", locked_until: failed.locked_until });
      }
      return reply.code(401).send({ error: "密码错误" });
    }

    return securityRepo.unlock();
  });

  app.post("/api/admin/lock", async (req) => securityRepo.lock(adminTokenFromRequest(req)));

  app.get("/api/admin/settings", { preHandler: requireUnlockedPreHandler }, async (req) => {
    return { display: settingsRepo.getDisplay(), security: await securityRepo.session(adminTokenFromRequest(req)) };
  });

  app.patch("/api/admin/settings", { preHandler: requireUnlockedPreHandler }, async (req, reply) => {
    const parsed = updateDisplaySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "参数校验失败", details: parsed.error.flatten() });
    }
    return { display: await settingsRepo.updateDisplay(parsed.data), security: await securityRepo.session(adminTokenFromRequest(req)) };
  });

  app.post("/api/admin/password", { preHandler: requireUnlockedPreHandler }, async (req, reply) => {
    const parsed = adminChangePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "参数校验失败", details: parsed.error.flatten() });
    }

    if (!(await securityRepo.verifyPassword(parsed.data.current_password))) {
      return reply.code(401).send({ error: "当前密码错误" });
    }

    await securityRepo.setPassword(parsed.data.new_password);
    return { ok: true, security: { unlocked: false, unlock_expires_at: null } };
  });
}
