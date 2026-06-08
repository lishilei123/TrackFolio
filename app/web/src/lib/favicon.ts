import type { DisplaySetting } from "../types";

const PRESET_ICON_COLORS = {
  dark: {
    bg: "#0f1115",
    accent: "#7f9fca",
  },
  light: {
    bg: "#edf0f2",
    accent: "#5b6670",
  },
};

function iconSvg(bg: string, accent: string): string {
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <rect width="24" height="24" rx="5" fill="${bg}" />
  <path d="M4 17l5-5 4 4 7-8" fill="none" stroke="${accent}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M16 8h4v4" fill="none" stroke="${accent}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" />
</svg>`.trim();
}

function ensureIconLink(): HTMLLinkElement {
  const existing = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (existing) return existing;
  const link = document.createElement("link");
  link.rel = "icon";
  document.head.appendChild(link);
  return link;
}

function ensureThemeMeta(): HTMLMetaElement {
  const existing = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (existing) return existing;
  const meta = document.createElement("meta");
  meta.name = "theme-color";
  document.head.appendChild(meta);
  return meta;
}

function resolveIconColors(display: DisplaySetting | null, prefersLight: boolean): { bg: string; accent: string } {
  if (display?.theme === "custom" && display.custom_theme) {
    return {
      bg: display.custom_theme.bg,
      accent: display.custom_theme.accent,
    };
  }
  const theme = display?.theme === "auto" ? (prefersLight ? "light" : "dark") : display?.theme ?? "dark";
  return theme === "light" ? PRESET_ICON_COLORS.light : PRESET_ICON_COLORS.dark;
}

function applyBrowserIcon(display: DisplaySetting | null, prefersLight: boolean): void {
  const colors = resolveIconColors(display, prefersLight);
  const link = ensureIconLink();
  link.type = "image/svg+xml";
  link.href = `data:image/svg+xml,${encodeURIComponent(iconSvg(colors.bg, colors.accent))}`;
  ensureThemeMeta().content = colors.bg;
}

export function syncBrowserIcon(display: DisplaySetting | null): () => void {
  const mql = window.matchMedia("(prefers-color-scheme: light)");
  const apply = () => applyBrowserIcon(display, mql.matches);
  apply();
  if (display?.theme !== "auto") return () => undefined;
  mql.addEventListener("change", apply);
  return () => mql.removeEventListener("change", apply);
}
