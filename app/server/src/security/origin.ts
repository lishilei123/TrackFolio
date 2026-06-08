import type { FastifyRequest } from "fastify";

export function originFromRequest(req: FastifyRequest): string | null {
  const rawOrigin = req.headers.origin;
  const origin = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
  if (origin) return origin;

  const rawReferer = req.headers.referer;
  const referer = Array.isArray(rawReferer) ? rawReferer[0] : rawReferer;
  if (!referer) return null;

  try {
    return new URL(referer).origin;
  } catch {
    return "invalid";
  }
}

export function requestHostOrigin(req: FastifyRequest): string | null {
  const protoHeader = req.headers["x-forwarded-proto"];
  const proto = (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader)?.split(",")[0]?.trim() || req.protocol;
  const hostHeader = req.headers["x-forwarded-host"] ?? req.headers.host;
  const host = (Array.isArray(hostHeader) ? hostHeader[0] : hostHeader)?.split(",")[0]?.trim();
  return host ? `${proto}://${host}` : null;
}

export function isAllowedRequestOrigin(req: FastifyRequest): boolean {
  const origin = originFromRequest(req);
  if (!origin) return true;
  const hostOrigin = requestHostOrigin(req);
  return Boolean(hostOrigin && origin === hostOrigin);
}
