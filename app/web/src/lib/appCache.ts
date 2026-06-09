import type { DisplaySetting, Meta } from "../types";

const DISPLAY_CACHE_KEY = "trackfolio.display.v1";
const META_CACHE_KEY = "trackfolio.meta.v1";

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 存储空间不足或隐私模式禁用时，继续走网络数据。 */
  }
}

export function loadCachedDisplay(): DisplaySetting | null {
  const cached = readJson<DisplaySetting>(DISPLAY_CACHE_KEY);
  if (!cached || typeof cached.updated_at !== "string") return null;
  return cached;
}

export function saveCachedDisplay(display: DisplaySetting): void {
  writeJson(DISPLAY_CACHE_KEY, display);
}

export function loadCachedMeta(): Meta | null {
  return readJson<Meta>(META_CACHE_KEY);
}

export function saveCachedMeta(meta: Meta): void {
  writeJson(META_CACHE_KEY, meta);
}

