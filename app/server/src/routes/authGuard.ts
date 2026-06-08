import type { FastifyReply, FastifyRequest } from "fastify";
import { securityRepo } from "../repositories/security.js";
import { isAllowedRequestOrigin } from "../security/origin.js";

export function adminTokenFromRequest(req: FastifyRequest): string | null {
  const raw = req.headers["x-admin-token"];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw ?? null;
}

export async function requireAllowedOriginPreHandler(req: FastifyRequest, reply: FastifyReply) {
  if (isAllowedRequestOrigin(req)) return;
  return reply.code(403).send({ error: "请求来源不被允许" });
}

export async function requireUnlockedPreHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!isAllowedRequestOrigin(req)) return reply.code(403).send({ error: "请求来源不被允许" });
  if (await securityRepo.isUnlocked(adminTokenFromRequest(req))) return;
  return reply.code(401).send({ error: "请先输入后台密码" });
}
