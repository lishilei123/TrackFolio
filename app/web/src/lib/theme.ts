import type { CustomTheme } from "../types";
import { mix, readableContrast, withAlpha } from "./color";

// 用户进入「自定义」主题时的默认种子（≈ 现有深色观感），保证一上来就有合理初值。
export const DEFAULT_CUSTOM_THEME: CustomTheme = {
  base: "dark",
  accent: "#7f9fca",
  bg: "#0f1115",
  surface: "#242830",
  border: "#a0a6b0",
  text: "#e2e4e8",
  textDim: "#a2a9b4",
};

// 后台取色器逐项渲染用的元数据（顺序即展示顺序）。
export const CUSTOM_THEME_FIELDS: Array<{ key: keyof Omit<CustomTheme, "base">; label: string }> = [
  { key: "bg", label: "底座颜色" },
  { key: "accent", label: "强调色" },
  { key: "surface", label: "面板表面" },
  { key: "border", label: "边框" },
  { key: "text", label: "主文字" },
  { key: "textDim", label: "次级文字" },
];

/**
 * 把 6 个基础色展开成完整的 CSS 变量覆盖表：
 * - surface / border 以 alpha 叠加在背景上，保留玻璃透明质感；
 * - accent 自动派生柔光、描边与对比文字色；
 * - bg-1 略提亮、text-faint 朝背景再淡一档。
 */
export function deriveCustomVars(ct: CustomTheme): Record<string, string> {
  return {
    "--bg-0": ct.bg,
    "--bg-1": mix(ct.bg, "#ffffff", 0.035),
    "--header-bg": withAlpha(ct.bg, 0.62),

    "--surface": withAlpha(ct.surface, 0.06),
    "--surface-2": withAlpha(ct.surface, 0.1),
    "--surface-hover": withAlpha(ct.surface, 0.055),
    "--surface-subtle": withAlpha(ct.surface, 0.03),

    "--border": withAlpha(ct.border, 0.16),
    "--border-strong": withAlpha(ct.border, 0.3),

    "--text": ct.text,
    "--text-dim": ct.textDim,
    "--text-faint": mix(ct.textDim, ct.bg, 0.4),

    "--accent": ct.accent,
    "--accent-soft": withAlpha(ct.accent, 0.12),
    "--accent-line": withAlpha(ct.accent, 0.42),
    "--accent-contrast": readableContrast(ct.accent),

    "--input-bg": withAlpha(ct.surface, 0.72),
    "--tooltip-bg": withAlpha(ct.surface, 0.96),
    "--tooltip-border": withAlpha(ct.border, 0.18),
    "--tooltip-text": ct.text,

    "--chart-axis": ct.textDim,
    "--chart-grid": withAlpha(ct.border, 0.4),
  };
}

// 切换到非自定义主题时，用于清除遗留的内联变量。
export const CUSTOM_VAR_NAMES = Object.keys(deriveCustomVars(DEFAULT_CUSTOM_THEME));
