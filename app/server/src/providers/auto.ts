import { marketStatusFor } from "../domain/marketHours.js";
import type { Asset, AssetType, Market } from "../domain/types.js";
import { settingsRepo } from "../repositories/settings.js";
import type { SecurityRef } from "./catalog.js";
import type { HistoryPoint, NavData, ProviderResult, QuoteData, QuoteProvider } from "./types.js";

/**
 * 兜底 Provider —— 把多个真实源串成有序链，同时实现两件事：
 *  1) 默认新浪优先，覆盖国内部署下的 A 股、港股、基金和美股；
 *  2) Yahoo 仅作为美股等海外标的的后备源，A 股/港股/场外基金不走 Yahoo，避免国内网络无意义超时；
 *  3) 保底：每个调用按序逐个尝试，前一个失败/超时自动落到下一个。
 * 业务层无感知，仍只依赖 QuoteProvider 接口。
 */
export class AutoProvider implements QuoteProvider {
  readonly name = "auto";
  private readonly providers: QuoteProvider[];
  private readonly historyFallbacks: QuoteProvider[];
  private readonly now: () => Date;
  private readonly useUsPremarketPnl: () => boolean;
  private readonly useUsPostmarketPnl: () => boolean;

  /** @param providers 期望顺序 [sina, yahoo] */
  constructor(
    providers: QuoteProvider[],
    historyFallbacks: QuoteProvider[] = [],
    options: { now?: () => Date; useUsPremarketPnl?: () => boolean; useUsPostmarketPnl?: () => boolean } = {},
  ) {
    if (providers.length === 0) throw new Error("AutoProvider needs at least one provider");
    this.providers = providers;
    this.historyFallbacks = historyFallbacks;
    this.now = options.now ?? (() => new Date());
    this.useUsPremarketPnl = options.useUsPremarketPnl ?? (() => {
      try {
        return settingsRepo.getDisplay().use_us_premarket_pnl;
      } catch {
        return false;
      }
    });
    this.useUsPostmarketPnl = options.useUsPostmarketPnl ?? (() => {
      try {
        return settingsRepo.getDisplay().use_us_postmarket_pnl;
      } catch {
        return false;
      }
    });
  }

  private withoutYahoo(): QuoteProvider[] {
    return this.providers.filter((p) => p.name !== "yahoo");
  }

  private providersFor(asset: Asset): QuoteProvider[] {
    if (asset.market === "CN" || asset.market === "HK") return this.withoutYahoo();
    return this.providers;
  }

  private shouldUseUsPremarketPnl(): boolean {
    return this.useUsPremarketPnl();
  }

  private shouldUseUsPostmarketPnl(): boolean {
    return this.useUsPostmarketPnl();
  }

  private quoteProvidersFor(asset: Asset): QuoteProvider[] {
    const list = this.providersFor(asset);
    const usStatus = marketStatusFor("US", this.now());
    const preferYahooForExtendedHours =
      asset.market === "US" &&
      ((usStatus === "pre" && this.shouldUseUsPremarketPnl()) ||
        ((usStatus === "post" || usStatus === "closed") && this.shouldUseUsPostmarketPnl()));
    if (!preferYahooForExtendedHours) {
      return list;
    }
    return [...list.filter((p) => p.name === "yahoo"), ...list.filter((p) => p.name !== "yahoo")];
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
    return this.tryEach(this.quoteProvidersFor(asset), (p) => p.fetchQuote(asset));
  }

  async fetchNav(asset: Asset): Promise<ProviderResult<NavData>> {
    // 场外基金净值只有 sina 有；国内 Yahoo 不可用，直接跳过。
    return this.tryEach(this.withoutYahoo(), (p) => p.fetchNav(asset));
  }

  async fetchHistory(asset: Asset, days: number): Promise<ProviderResult<HistoryPoint[]>> {
    const fallbacks = asset.market === "US" ? this.historyFallbacks : [];
    const list = [...this.providersFor(asset), ...fallbacks].filter((p) => typeof p.fetchHistory === "function");
    return this.tryEach(list, (p) => p.fetchHistory!(asset, days));
  }

  async search(
    query: string,
    opts: { market?: Market; asset_type?: AssetType; limit?: number } = {},
  ): Promise<SecurityRef[]> {
    // 始终 sina 优先：保证中文"美光"在新浪可达时一定能搜到；为空/抛错再试下一个
    const list = (opts.market === "CN" || opts.market === "HK" || opts.asset_type === "FUND" ? this.withoutYahoo() : this.providers)
      .filter((p) => typeof p.search === "function");
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
