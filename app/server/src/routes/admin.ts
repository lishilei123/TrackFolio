import type { FastifyInstance } from "fastify";
import { adminChangePasswordSchema, adminUnlockSchema, updateDisplaySchema } from "../domain/validate.js";
import { securityRepo } from "../repositories/security.js";
import { settingsRepo } from "../repositories/settings.js";
import { revalidateAll } from "../services/refresh.js";
import { adminTokenFromRequest, requireAllowedOriginPreHandler, requireUnlockedPreHandler } from "./authGuard.js";
import { issueCaptcha, verifyCaptcha } from "../security/captcha.js";

// 失败累计达到该值后，后续解锁请求必须附带通过校验的验证码
const CAPTCHA_REQUIRED_AFTER = 1;

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/admin/session", { preHandler: requireAllowedOriginPreHandler }, async (req) => {
    const session = await securityRepo.session(adminTokenFromRequest(req));
    const lock = await securityRepo.isLocked();
    return { ...session, captcha_required: !lock.locked && lock.failed_attempt_count >= CAPTCHA_REQUIRED_AFTER };
  });

  // 下发验证码：答案仅存于服务端，前端只拿到 id 与题面
  app.get("/api/admin/captcha", { preHandler: requireAllowedOriginPreHandler }, async () => issueCaptcha());

  app.post("/api/admin/unlock", { preHandler: requireAllowedOriginPreHandler }, async (req, reply) => {
    const parsed = adminUnlockSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "参数校验失败", details: parsed.error.flatten() });
    }

    const locked = await securityRepo.isLocked();
    if (locked.locked) {
      return reply.code(423).send({ error: "后台已临时锁定，请稍后再试", locked_until: locked.locked_until });
    }

    // 失败过的来源必须先通过验证码（服务端校验，前端无法绕过）
    if (locked.failed_attempt_count >= CAPTCHA_REQUIRED_AFTER) {
      if (!verifyCaptcha(parsed.data.captcha_id, parsed.data.captcha_answer)) {
        return reply.code(400).send({ error: "验证码错误", captcha_required: true, captcha: issueCaptcha() });
      }
    }

    if (!(await securityRepo.verifyPassword(parsed.data.password))) {
      const failed = await securityRepo.recordFailedAttempt();
      if (failed.locked) {
        return reply.code(423).send({ error: "密码错误次数过多，请稍后再试", locked_until: failed.locked_until });
      }
      return reply.code(401).send({ error: "密码错误", captcha_required: true, captcha: issueCaptcha() });
    }

    return securityRepo.unlock();
  });

  app.post("/api/admin/lock", { preHandler: requireAllowedOriginPreHandler }, async (req) => securityRepo.lock(adminTokenFromRequest(req)));

  app.get("/api/admin/settings", { preHandler: requireUnlockedPreHandler }, async (req) => {
    return { display: settingsRepo.getDisplay(), security: await securityRepo.session(adminTokenFromRequest(req)) };
  });

  app.patch("/api/admin/settings", { preHandler: requireUnlockedPreHandler }, async (req, reply) => {
    const parsed = updateDisplaySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "参数校验失败", details: parsed.error.flatten() });
    }
    const previousTimezone = settingsRepo.getDisplay().settlement_timezone;
    const display = await settingsRepo.updateDisplay(parsed.data);
    const revalidate = parsed.data.settlement_timezone && parsed.data.settlement_timezone !== previousTimezone
      ? await revalidateAll()
      : undefined;
    return {
      display,
      security: await securityRepo.session(adminTokenFromRequest(req)),
      ...(revalidate ? { revalidate } : {}),
    };
  });

  // 校验：按当前资产配置重新拉取行情并重算历史与今日盈亏
  app.post("/api/admin/validate", { preHandler: requireUnlockedPreHandler }, async () => revalidateAll());

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
