// 领域类型定义 —— 对应需求文档第 7 章数据模型

export type AssetType = "STOCK" | "FUND";
export type Market = "CN" | "US" | "HK";
export type Currency = "CNY" | "USD" | "HKD";

/** 行情/净值数据可用状态 */
export type QuoteStatus = "ok" | "stale" | "unavailable" | "estimated";

/** 市场交易状态 */
export type MarketStatus =
  | "pre"      // 盘前
  | "open"     // 盘中
  | "post"     // 盘后
  | "closed"   // 休市
  | "delayed"  // 数据延迟
  | "unknown";

export const ASSET_TYPES: AssetType[] = ["STOCK", "FUND"];
export const MARKETS: Market[] = ["CN", "US", "HK"];
export const CURRENCIES: Currency[] = ["CNY", "USD", "HKD"];

/** 各市场默认币种 */
export const DEFAULT_CURRENCY: Record<Market, Currency> = {
  CN: "CNY",
  US: "USD",
  HK: "HKD",
};

export interface Asset {
  id: string;
  asset_type: AssetType;
  market: Market;
  symbol: string;
  name: string;
  currency: Currency;
  exchange: string | null;
  fund_type: string | null; // 场内/场外/ETF/LOF...
  quote_status: QuoteStatus;
  created_at: string;
  updated_at: string;
}

export interface Position {
  id: string;
  asset_id: string;
  quantity: number;
  avg_cost: number;
  total_fee: number;
  opened_at: string | null;
  closed_at: string | null;
  tags: string[];
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** 行情/净值快照 */
export interface QuoteSnapshot {
  asset_id: string;
  latest_price: number | null;
  latest_nav: number | null;
  previous_close: number | null;
  pre_previous_close: number | null;
  previous_nav: number | null;
  nav_date: string | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  change_amount: number | null;
  change_percent: number | null;
  market_status: MarketStatus;
  quote_time: string | null;
  provider: string;
  status: QuoteStatus;
}

export interface ExchangeRate {
  base_currency: Currency;
  target_currency: Currency;
  rate: number;
  rate_time: string;
  provider: string;
}

export interface DisplaySetting {
  id: number;
  settlement_currency: Currency;
  show_original_currency: boolean;
  exchange_rate_provider: string;
  theme: "dark" | "light";
  quote_refresh_interval: number; // 秒
  updated_at: string;
}

/** 统一资产标识，例如 STOCK:CN:600519 */
export function assetKey(a: Pick<Asset, "asset_type" | "market" | "symbol">): string {
  return `${a.asset_type}:${a.market}:${a.symbol}`;
}
