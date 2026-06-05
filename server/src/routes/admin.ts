import type { FastifyInstance, FastifyReply } from "fastify";
import { adminChangePasswordSchema, adminUnlockSchema, updateDisplaySchema } from "../domain/validate.js";
import { securityRepo } from "../repositories/security.js";
import { settingsRepo } from "../repositories/settings.js";

async function requireUnlocked(reply: FastifyReply): Promise<boolean> {
  if (await securityRepo.isUnlocked()) return true;
  reply.code(401).send({ error: "请先输入后台密码" });
  return false;
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/admin/session", async () => securityRepo.session());

  app.post("/api/admin/unlock", async (req, reply) => {
    const parsed = adminUnlockSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "参数校验失败", details: parsed.error.flatten() });
    }

    if (!(await securityRepo.verifyPassword(parsed.data.password))) {
      await securityRepo.recordFailedAttempt();
      return reply.code(401).send({ error: "密码错误" });
    }

    return securityRepo.unlock();
  });

  app.post("/api/admin/lock", async () => securityRepo.lock());

  app.get("/api/admin/settings", async (_req, reply) => {
    if (!(await requireUnlocked(reply))) return;
    return { display: settingsRepo.getDisplay(), security: await securityRepo.session() };
  });

  app.patch("/api/admin/settings", async (req, reply) => {
    if (!(await requireUnlocked(reply))) return;
    const parsed = updateDisplaySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "参数校验失败", details: parsed.error.flatten() });
    }
    return { display: await settingsRepo.updateDisplay(parsed.data), security: await securityRepo.session() };
  });

  app.post("/api/admin/password", async (req, reply) => {
    if (!(await requireUnlocked(reply))) return;
    const parsed = adminChangePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "参数校验失败", details: parsed.error.flatten() });
    }

    if (!(await securityRepo.verifyPassword(parsed.data.current_password))) {
      return reply.code(401).send({ error: "当前密码错误" });
    }

    await securityRepo.setPassword(parsed.data.new_password);
    return { ok: true, security: await securityRepo.session() };
  });
}
