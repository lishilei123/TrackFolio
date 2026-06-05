import type { Asset, QuoteSnapshot } from "../domain/types.js";
import { getProvider } from "../providers/index.js";
import { assetsRepo } from "../repositories/assets.js";
import { quotesRepo } from "../repositories/quotes.js";
import { fxService } from "./fx.js";
import { snapshotToday } from "./history.js";
import { isNavBased } from "./pnl.js";

export interface RefreshResult {
  total: number;
  succeeded: number;
  failed: number;
  failed_assets: string[];
  refreshed_at: string;
  fx: {
    ok: boolean;
    provider: string;
    rate_time: string | null;
    preserved_last_good: boolean;
    error?: string;
  };
}

/**
 * 刷新一个资产的行情/净值。
 * 失败时不清空已有数据，仅把状态标记为 stale/unavailable（需求 5.4 降级要求）。
 */
async function refreshAsset(asset: Asset): Promise<boolean> {
  const provider = getProvider();
  try {
    if (isNavBased(asset)) {
      const res = await provider.fetchNav(asset);
      if (!res.ok) {
        await markFailure(asset);
        return false;
      }
      const d = res.data;
      const existing = await quotesRepo.get(asset.id);
      const snapshot: QuoteSnapshot = {
        asset_id: asset.id,
        latest_price: null,
        latest_nav: d.latest_nav,
        previous_close: null,
        pre_previous_close: null,
        previous_nav: d.previous_nav,
        nav_date: d.nav_date,
        open: null,
        high: null,
        low: null,
        volume: null,
        change_amount: null,
        change_percent: d.change_percent,
        market_status: existing?.market_status ?? "unknown",
        quote_time: new Date().toISOString(),
        provider: provider.name,
        status: d.is_estimated ? "estimated" : "ok",
      };
      await quotesRepo.upsert(snapshot);
      await assetsRepo.updateQuoteStatus(asset.id, snapshot.status);
      return true;
    }

    const res = await provider.fetchQuote(asset);
    if (!res.ok) {
      await markFailure(asset);
      return false;
    }
    const d = res.data;
    const snapshot: QuoteSnapshot = {
      asset_id: asset.id,
      latest_price: d.latest_price,
      latest_nav: null,
      previous_close: d.previous_close,
      pre_previous_close: d.pre_previous_close,
      previous_nav: null,
      nav_date: null,
      open: d.open,
      high: d.high,
      low: d.low,
      volume: d.volume,
      change_amount: d.change_amount,
      change_percent: d.change_percent,
      market_status: d.market_status,
      quote_time: d.quote_time,
      provider: provider.name,
      status: "ok",
    };
    await quotesRepo.upsert(snapshot);
    await assetsRepo.updateQuoteStatus(asset.id, "ok");
    return true;
  } catch {
    await markFailure(asset);
    return false;
  }
}

async function markFailure(asset: Asset): Promise<void> {
  const existing = await quotesRepo.get(asset.id);
  // 有旧数据 → 标记 stale 保留；无旧数据 → unavailable
  const status = existing && (existing.latest_price != null || existing.latest_nav != null)
    ? "stale"
    : "unavailable";
  await quotesRepo.markStatus(asset.id, status);
  await assetsRepo.updateQuoteStatus(asset.id, status);
}

/** 刷新全部资产行情 */
export async function refreshAll(): Promise<RefreshResult> {
  const fx = await fxService.refreshRates();
  const assets = await assetsRepo.list();
  const results = await Promise.all(
    assets.map(async (a) => ({ asset: a, ok: await refreshAsset(a) })),
  );
  const failed = results.filter((r) => !r.ok);
  // 刷新后把今天的盈亏写入快照，实现逐日历史累加（需求 5.5.4）
  try {
    await snapshotToday();
  } catch {
    /* 快照失败不影响刷新主流程 */
  }
  return {
    total: assets.length,
    succeeded: results.length - failed.length,
    failed: failed.length,
    failed_assets: failed.map((r) => r.asset.id),
    refreshed_at: new Date().toISOString(),
    fx: {
      ok: fx.ok,
      provider: fx.provider,
      rate_time: fx.rate_time,
      preserved_last_good: fx.preserved_last_good,
      error: fx.error,
    },
  };
}

/** 刷新单个资产 */
export async function refreshOne(assetId: string): Promise<boolean> {
  const asset = await assetsRepo.get(assetId);
  if (!asset) return false;
  return refreshAsset(asset);
}
