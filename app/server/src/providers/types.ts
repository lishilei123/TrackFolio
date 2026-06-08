import type { Asset, AssetType, Market, MarketStatus } from "../domain/types.js";
import type { SecurityRef } from "./catalog.js";

/** 行情字段（股票/场内基金） */
export interface QuoteData {
  latest_price: number;
  previous_close: number;
  /** 前一交易日的前一收盘价；真实行情接口通常不提供，置 null（昨日盈亏据此降级） */
  pre_previous_close: number | null;
  open: number;
  high: number;
  low: number;
  volume: number;
  change_amount: number;
  change_percent: number;
  market_status: MarketStatus;
  quote_time: string;
}

/** 历史价格/净值点（用于历史盈亏曲线） */
export interface HistoryPoint {
  date: string; // YYYY-MM-DD
  /** 股票/场内基金为收盘价，场外基金为单位净值 */
  close: number;
}

/** 场外基金净值字段 */
export interface NavData {
  latest_nav: number;
  cumulative_nav: number;
  previous_nav: number;
  nav_date: string;
  change_percent: number;
  fund_type: string;
  is_estimated: boolean;
}

export type ProviderResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "unavailable" | "error" };

/**
 * 行情/净值 Provider Adapter 接口。
 * 业务层只依赖此接口，具体供应商（新浪 / 腾讯 / Yahoo / 自建）可替换。
 * 见需求文档 5.4：行情服务必须通过可替换 Provider Adapter 接入。
 */
export interface QuoteProvider {
  readonly name: string;
  /** 拉取股票/场内基金实时行情 */
  fetchQuote(asset: Asset): Promise<ProviderResult<QuoteData>>;
  /** 拉取场外基金净值 */
  fetchNav(asset: Asset): Promise<ProviderResult<NavData>>;
  /**
   * 拉取近 days 天历史收盘价/净值（升序）。
   * 可选：真实 Provider 若不支持历史，可不实现，业务层据此跳过回填。
   */
  fetchHistory?(asset: Asset, days: number): Promise<ProviderResult<HistoryPoint[]>>;
  /**
   * 按代码/名称/拼音搜索标的（需求 5.2 搜索添加）。
   * 可选：Provider 可对接行情商搜索接口，不支持则由业务层据此跳过。
   */
  search?(query: string, opts?: { market?: Market; asset_type?: AssetType; limit?: number }): Promise<SecurityRef[]>;
}
