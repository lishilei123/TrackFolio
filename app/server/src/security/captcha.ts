import { randomBytes, randomInt } from "node:crypto";

// 服务端验证码：答案只存在于服务端内存，前端只拿到 id 与一张 SVG 图，无法绕过。
// 字符以扭曲 + 干扰线/噪点的图形呈现，比明文算术更难被脚本自动识别。
// 一次性消费 + TTL 过期，单进程内存存储（重启即失效，可接受）。

const CAPTCHA_TTL_MS = 3 * 60_000;
const MAX_ENTRIES = 1000;
const CODE_LENGTH = 5;
// 去掉易混字符（0/O、1/I/L）后的字母表，大小写不敏感校验。
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

interface CaptchaEntry {
  answer: string; // 大写规范化后的答案
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
  /** SVG 图形验证码（data URL，前端用 <img> 直接渲染） */
  image: string;
}

function randomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(0, ALPHABET.length)];
  return code;
}

/** 在 [min, max] 闭区间内取整数 */
function between(min: number, max: number): number {
  return randomInt(min, max + 1);
}

/** 把字符渲染成带随机扭曲、颜色与干扰的 SVG 图（data URL）。 */
function renderSvg(code: string): string {
  const width = 150;
  const height = 50;
  const step = width / (code.length + 1);

  const chars = [...code]
    .map((ch, i) => {
      const x = Math.round(step * (i + 1));
      const y = between(30, 38);
      const rotate = between(-28, 28);
      const size = between(26, 34);
      const hue = between(0, 360);
      return `<text x="${x}" y="${y}" font-size="${size}" font-family="monospace" font-weight="700" fill="hsl(${hue} 70% 62%)" transform="rotate(${rotate} ${x} ${y})">${ch}</text>`;
    })
    .join("");

  // 干扰线
  let noise = "";
  for (let i = 0; i < 5; i++) {
    const hue = between(0, 360);
    noise += `<line x1="${between(0, width)}" y1="${between(0, height)}" x2="${between(0, width)}" y2="${between(0, height)}" stroke="hsl(${hue} 60% 55%)" stroke-width="1" opacity="0.5"/>`;
  }
  // 噪点
  for (let i = 0; i < 28; i++) {
    noise += `<circle cx="${between(0, width)}" cy="${between(0, height)}" r="1" fill="hsl(${between(0, 360)} 60% 60%)" opacity="0.6"/>`;
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="#0b0f17"/>` +
    noise +
    chars +
    `</svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

/** 生成图形验证码，返回 id 与 SVG 图（答案仅留存服务端） */
export function issueCaptcha(): IssuedCaptcha {
  prune();
  const code = randomCode();
  const id = randomBytes(16).toString("hex");
  store.set(id, { answer: code, expiresAt: Date.now() + CAPTCHA_TTL_MS });
  return { id, image: renderSvg(code) };
}

/** 校验并一次性消费验证码（大小写不敏感）；id 无效/过期/答案不符均返回 false */
export function verifyCaptcha(id: string | undefined, answer: unknown): boolean {
  if (!id) return false;
  const entry = store.get(id);
  if (!entry) return false;
  store.delete(id); // 一次性：无论对错都作废，防重放
  if (entry.expiresAt <= Date.now()) return false;
  const text = String(answer ?? "").trim().toUpperCase();
  return text.length > 0 && text === entry.answer;
}
