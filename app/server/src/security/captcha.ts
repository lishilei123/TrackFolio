import { randomBytes, randomInt } from "node:crypto";

// 服务端验证码：答案只存在于服务端内存，前端只拿到 id 与题面，无法绕过。
// 一次性消费 + TTL 过期，单进程内存存储（重启即失效，可接受）。

const CAPTCHA_TTL_MS = 3 * 60_000;
const MAX_ENTRIES = 1000;

interface CaptchaEntry {
  answer: number;
  expiresAt: number;
}

const store = new Map<string, CaptchaEntry>();

function prune(): void {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (entry.expiresAt <= now) store.delete(id);
  }
  // 兜底：异常堆积时丢弃最旧的条目，避免无限增长
  if (store.size > MAX_ENTRIES) {
    const overflow = store.size - MAX_ENTRIES;
    let i = 0;
    for (const id of store.keys()) {
      if (i++ >= overflow) break;
      store.delete(id);
    }
  }
}

export interface IssuedCaptcha {
  id: string;
  question: string;
}

/** 生成一道一位数加法验证码，返回 id 与题面（答案仅留存服务端） */
export function issueCaptcha(): IssuedCaptcha {
  prune();
  const a = randomInt(1, 10);
  const b = randomInt(1, 10);
  const id = randomBytes(16).toString("hex");
  store.set(id, { answer: a + b, expiresAt: Date.now() + CAPTCHA_TTL_MS });
  return { id, question: `${a} + ${b}` };
}

/** 校验并一次性消费验证码；id 无效/过期/答案不符均返回 false */
export function verifyCaptcha(id: string | undefined, answer: unknown): boolean {
  if (!id) return false;
  const entry = store.get(id);
  if (!entry) return false;
  store.delete(id); // 一次性：无论对错都作废，防重放
  if (entry.expiresAt <= Date.now()) return false;
  const n = typeof answer === "number" ? answer : Number(String(answer ?? "").trim());
  return Number.isFinite(n) && n === entry.answer;
}
