import { AutoProvider } from "./auto.js";
import { NasdaqHistoryProvider } from "./nasdaq.js";
import { SinaProvider } from "./sina.js";
import type { QuoteProvider } from "./types.js";
import { YahooProvider } from "./yahoo.js";

/**
 * 固定使用自动 Provider：
 * - 新浪优先，覆盖国内部署下的 A 股、港股、基金和美股；
 * - Yahoo 只作为美股等海外标的的后备源；
 * - 美股历史 K 线追加 Nasdaq 兜底。
 */
let current: QuoteProvider | null = null;

export function getProvider(): QuoteProvider {
  if (current) return current;
  current = new AutoProvider([new SinaProvider(), new YahooProvider()], [new NasdaqHistoryProvider()]);
  return current;
}

export type { QuoteProvider };
