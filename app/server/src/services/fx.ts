import { db } from "../db/index.js";
import { CURRENCIES } from "../domain/types.js";
import type { Currency } from "../domain/types.js";
import { getFxProvider, resolveFxProviderName } from "../providers/fx/index.js";
import type { FxRate } from "../providers/fx/types.js";

export interface RateInfo {
  rate: number;
  rate_time: string;
  provider: string;
  available: boolean;
}

export interface FxRefreshResult {
  ok: boolean;
  provider: string;
  rate_time: string | null;
  updated: number;
  preserved_last_good: boolean;
  error?: string;
}

export interface FxRateInfo extends RateInfo {
  from: Currency;
  to: Currency;
}

export interface FxStatus {
  provider_setting: string;
  source: string | null;
  last_update: string | null;
  stale: boolean;
}

const STALE_MS = 24 * 60 * 60 * 1000;

function isCurrency(v: string): v is Currency {
  return CURRENCIES.includes(v as Currency);
}

interface RateRow {
  base_currency: Currency;
  target_currency: Currency;
  rate: number;
  rate_time: string;
  provider: string;
}

// 汇率表很小且被盈亏计算同步读取，缓存到内存：getRate/listRates/getStatus 保持同步。
const cache = new Map<string, RateRow>();

function rateKey(base: string, target: string): string {
  return `${base}-${target}`;
}

async function reloadCache(): Promise<void> {
  const rows = await db.all<RateRow>("SELECT base_currency, target_currency, rate, rate_time, provider FROM exchange_rates");
  cache.clear();
  for (const r of rows) cache.set(rateKey(r.base_currency, r.target_currency), r);
}

async function upsertMany(rows: FxRate[]): Promise<void> {
  await db.tx(async () => {
    for (const r of rows) {
      await db.run(
        `INSERT INTO exchange_rates (base_currency, target_currency, rate, rate_time, provider)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(base_currency, target_currency) DO UPDATE SET
           rate = excluded.rate,
           rate_time = excluded.rate_time,
           provider = excluded.provider`,
        [r.base_currency, r.target_currency, r.rate, r.rate_time, r.provider],
      );
    }
  });
  await reloadCache();
}

function maxRateMeta(): { rate_time: string | null; provider: string | null } {
  let best: RateRow | null = null;
  for (const r of cache.values()) {
    if (r.base_currency === r.target_currency) continue;
    if (!best || r.rate_time > best.rate_time) best = r;
  }
  return { rate_time: best?.rate_time ?? null, provider: best?.provider ?? null };
}

/**
 * 汇率服务。统一结算货币汇总时使用（需求 5.6）。
 * 汇率不可用时返回 available=false；实时刷新失败时保留最后成功汇率。
 */
export const fxService = {
  /** 应用启动时预热汇率缓存（initDb 之后调用一次）。 */
  async loadCache(): Promise<void> {
    await reloadCache();
  },

  getRate(base: Currency, target: Currency): RateInfo {
    if (base === target) {
      return { rate: 1, rate_time: new Date().toISOString(), provider: "identity", available: true };
    }
    const row = cache.get(rateKey(base, target));
    if (!row || !Number.isFinite(row.rate) || row.rate <= 0) {
      return { rate: 0, rate_time: "", provider: "", available: false };
    }
    return { rate: row.rate, rate_time: row.rate_time, provider: row.provider, available: true };
  },

  listRates(target: Currency): FxRateInfo[] {
    return CURRENCIES.map((from) => ({ from, to: target, ...this.getRate(from, target) }));
  },

  getStatus(): FxStatus {
    const meta = maxRateMeta();
    const ts = meta.rate_time ? Date.parse(meta.rate_time) : NaN;
    return {
      provider_setting: resolveFxProviderName(),
      source: meta.provider,
      last_update: meta.rate_time,
      stale: !Number.isFinite(ts) || Date.now() - ts > STALE_MS,
    };
  },

  async refreshRates(): Promise<FxRefreshResult> {
    const provider = getFxProvider();
    const before = maxRateMeta();
    try {
      const res = await provider.fetchRates([...CURRENCIES]);
      if (!res.ok) {
        return {
          ok: false,
          provider: provider.name,
          rate_time: before.rate_time,
          updated: 0,
          preserved_last_good: true,
          error: res.reason,
        };
      }
      await upsertMany(res.data);
      const after = maxRateMeta();
      return {
        ok: true,
        provider: after.provider ?? provider.name,
        rate_time: after.rate_time,
        updated: res.data.length,
        preserved_last_good: false,
      };
    } catch (e) {
      return {
        ok: false,
        provider: provider.name,
        rate_time: before.rate_time,
        updated: 0,
        preserved_last_good: true,
        error: e instanceof Error ? e.message : "unknown_error",
      };
    }
  },

  /** 把金额从 base 币种折算为 target 币种 */
  convert(amount: number, base: Currency, target: Currency): { value: number | null; rate: RateInfo } {
    const rate = this.getRate(base, target);
    if (!rate.available) return { value: null, rate };
    return { value: amount * rate.rate, rate };
  },

  isCurrency,
};
