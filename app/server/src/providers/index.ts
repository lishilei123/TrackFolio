import { AutoProvider } from "./auto.js";
import { NasdaqHistoryProvider } from "./nasdaq.js";
import { SinaProvider } from "./sina.js";
import type { QuoteProvider } from "./types.js";
import { YahooProvider } from "./yahoo.js";

/**
 * Provider 注册表。默认 auto：按国内/国外自动切换并逐源保底
 * （国内 sina 优先、国外 yahoo 优先，失败自动落到下一个；美股历史 K 线追加 Nasdaq 兜底）。
 * 可通过 TRACKFOLIO_PROVIDER 显式锁定 sina / yahoo。
 */
const registry: Record<string, () => QuoteProvider> = {
  auto: () => new AutoProvider([new SinaProvider(), new YahooProvider()], [new NasdaqHistoryProvider()]),
  sina: () => new SinaProvider(),
  yahoo: () => new YahooProvider(),
};

let current: QuoteProvider | null = null;

export function getProvider(): QuoteProvider {
  if (current) return current;
  const name = process.env.TRACKFOLIO_PROVIDER ?? "auto";
  const factory = registry[name] ?? registry.auto;
  current = factory();
  return current;
}

export type { QuoteProvider };
