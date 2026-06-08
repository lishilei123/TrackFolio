import { AutoProvider } from "./auto.js";
import { NasdaqHistoryProvider } from "./nasdaq.js";
import { SinaProvider } from "./sina.js";
import type { QuoteProvider } from "./types.js";
import { YahooProvider } from "./yahoo.js";
import { settingsRepo } from "../repositories/settings.js";

/**
 * Provider 注册表。默认 auto：按国内/国外自动切换并逐源保底
 * （国内 sina 优先、国外 yahoo 优先，失败自动落到下一个；美股历史 K 线追加 Nasdaq 兜底）。
 * 跟随后台「行情来源」设置。
 */
const registry: Record<string, () => QuoteProvider> = {
  auto: () => new AutoProvider([new SinaProvider(), new YahooProvider()], [new NasdaqHistoryProvider()]),
  sina: () => new SinaProvider(),
  yahoo: () => new YahooProvider(),
};

let current: QuoteProvider | null = null;
let currentName: string | null = null;

function resolveProviderName(): string {
  const raw = settingsRepo.getDisplay().quote_provider ?? "auto";
  return registry[raw] ? raw : "auto";
}

export function getProvider(): QuoteProvider {
  const name = resolveProviderName();
  if (current && currentName === name) return current;
  const factory = registry[name];
  current = factory();
  currentName = name;
  return current;
}

export type { QuoteProvider };
