// 纯函数色彩工具：自定义主题从 6 个基础色派生其余 token 时使用，无第三方依赖。

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** 解析 #RGB / #RRGGBB；非法输入回退到黑色，避免抛错打断主题应用。 */
export function parseHex(hex: string): Rgb {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

function toHex({ r, g, b }: Rgb): string {
  return "#" + [r, g, b].map((c) => clamp(c).toString(16).padStart(2, "0")).join("");
}

/** 给颜色叠加透明度，输出 rgba()。 */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 在两色之间线性插值，t=0 取 a、t=1 取 b。用于提亮背景 / 再淡化文字。 */
export function mix(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  return toHex({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t,
  });
}

/** 相对亮度（sRGB 近似），用于决定强调色上应铺黑字还是白字。 */
export function luminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** 返回在给定底色上可读的对比色（深底→白，浅底→近黑）。 */
export function readableContrast(hex: string): string {
  return luminance(hex) > 0.55 ? "#04201c" : "#f0fdfa";
}
