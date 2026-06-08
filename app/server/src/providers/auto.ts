import type { Asset, AssetType, Market } from "../domain/types.js";
import type { SecurityRef } from "./catalog.js";
import type { HistoryPoint, NavData, ProviderResult, QuoteData, QuoteProvider } from "./types.js";

/**
 * 兜底 Provider —— 把多个真实源串成有序链，同时实现两件事：
 *  1) 自动按国内/国外切换：启动探测新浪可达性决定优先级（国内 sina 先、国外 yahoo 先）；
 *  2) 保底：每个调用按序逐个尝试，前一个失败/超时自动落到下一个。
 * 业务层无感知，仍只依赖 QuoteProvider 接口。
 */
export class AutoProvider implements QuoteProvider {
  readonly name = "auto";
  private readonly providers: QuoteProvider[];
  private readonly historyFallbacks: QuoteProvider[];
  /** 探测结果（缓存一次）：true=国内可达新浪 */
  private domesticPromise: Promise<boolean> | null = null;

  /** @param providers 期望顺序 [sina, yahoo]（国内优先序） */
  constructor(providers: QuoteProvider[], historyFallbacks: QuoteProvider[] = []) {
    if (providers.length === 0) throw new Error("AutoProvider needs at least one provider");
    this.providers = providers;
    this.historyFallbacks = historyFallbacks;
  }

  /** 探测是否能连上新浪（国内）。失败按国外处理。仅跑一次并缓存。 */
  private isDomestic(): Promise<boolean> {
    if (this.domesticPromise) return this.domesticPromise;
    this.domesticPromise = (async () => {
      try {
        const res = await fetch("https://hq.sinajs.cn/list=sh600519", {
          headers: { Referer: "https://finance.sina.com.cn" },
          signal: AbortSignal.timeout(2500),
        });
        return res.ok;
      } catch {
        return false;
      }
    })();
    return this.domesticPromise;
  }

  /** 按探测结果排序：国内→原序[sina,yahoo]；国外→反序[yahoo,sina] */
  private async ordered(): Promise<QuoteProvider[]> {
    const domestic = await this.isDomestic();
    return domestic ? this.providers : [...this.providers].reverse();
  }

  /** 按序尝试，返回首个 ok 的结果；全失败返回 unavailable */
  private async tryEach<T>(
    list: QuoteProvider[],
    fn: (p: QuoteProvider) => Promise<ProviderResult<T>> | undefined,
  ): Promise<ProviderResult<T>> {
    for (const p of list) {
      try {
        const r = await fn(p);
        if (r && r.ok) return r;
      } catch {
        /* 试下一个 */
      }
    }
    return { ok: false, reason: "unavailable" };
  }

  async fetchQuote(asset: Asset): Promise<ProviderResult<QuoteData>> {
    return this.tryEach(await this.ordered(), (p) => p.fetchQuote(asset));
  }

  async fetchNav(asset: Asset): Promise<ProviderResult<NavData>> {
    // 仅部分源实现 fetchNav（场外基金净值只有 sina 有）
    return this.tryEach(await this.ordered(), (p) => p.fetchNav(asset));
  }

  async fetchHistory(asset: Asset, days: number): Promise<ProviderResult<HistoryPoint[]>> {
    const list = [...(await this.ordered()), ...this.historyFallbacks].filter((p) => typeof p.fetchHistory === "function");
    return this.tryEach(list, (p) => p.fetchHistory!(asset, days));
  }

  async search(
    query: string,
    opts: { market?: Market; asset_type?: AssetType; limit?: number } = {},
  ): Promise<SecurityRef[]> {
    // 始终 sina 优先：保证中文"美光"在新浪可达时一定能搜到；为空/抛错再试下一个
    const list = this.providers.filter((p) => typeof p.search === "function");
    for (const p of list) {
      try {
        const r = await p.search!(query, opts);
        if (r.length > 0) return r;
      } catch {
        /* 试下一个 */
      }
    }
    return [];
  }
}
