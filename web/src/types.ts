// 与后端 API 对齐的类型（前端视图层）

export type AssetType = "STOCK" | "FUND";
export type Market = "CN" | "US" | "HK";
export type Currency = "CNY" | "USD" | "HKD";
export type QuoteStatus = "ok" | "stale" | "unavailable" | "estimated";
export type MarketStatus = "pre" | "open" | "post" | "closed" | "delayed" | "unknown";

export interface Asset {
  id: string;
  asset_type: AssetType;
  market: Market;
  symbol: string;
  name: string;
  currency: Currency;
  exchange: string | null;
  fund_type: string | null;
  quote_status: QuoteStatus;
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
}

export interface Transaction {
  id: string;
  asset_id: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  fee: number;
  currency: Currency;
  trade_time: string;
  external_key: string | null;
  note: string | null;
  created_at: string;
}

export interface QuoteSnapshot {
  latest_price: number | null;
  latest_nav: number | null;
  previous_close: number | null;
  previous_nav: number | null;
  nav_date: string | null;
  change_percent: number | null;
  market_status: MarketStatus;
  quote_time: string | null;
  provider: string;
  status: QuoteStatus;
}

export interface MetricValue {
  amount: number | null;
  percent: number | null;
  computable: boolean;
  estimated: boolean;
  reason?: string;
}

export interface Holding {
  asset: Asset;
  position: Position;
  quote: QuoteSnapshot | null;
  is_nav_based: boolean;
  latest: number | null;
  previous_close: number | null;
  currency: Currency;
  data_status: QuoteStatus;
  market_value: number | null;
  market_value_settled: number | null;
  today_pnl: MetricValue;
  yesterday_pnl: MetricValue;
  total_pnl: MetricValue;
  today_pnl_settled: number | null;
  total_pnl_settled: number | null;
  fx_rate: number | null;
}

export interface Overview {
  settlement_currency: Currency;
  total_market_value: number | null;
  total_cost: number | null;
  today_pnl: number | null;
  today_pnl_percent: number | null;
  yesterday_pnl: number | null;
  yesterday_pnl_percent: number | null;
  total_pnl: number | null;
  total_pnl_percent: number | null;
  fx_available: boolean;
  warnings: string[];
  as_of: string | null;
  holdings_count: number;
}

export interface PortfolioResponse {
  overview: Overview;
  holdings: Holding[];
}

export type PnlColorScheme = "green_up" | "red_up";

/** 自定义主题：在 dark/light 底座上覆盖 6 个基础色，其余 token 由其派生。 */
export interface CustomTheme {
  base: "dark" | "light";
  accent: string;
  bg: string;
  surface: string;
  border: string;
  text: string;
  textDim: string;
}

export interface DisplaySetting {
  id: number;
  settlement_currency: Currency;
  show_original_currency: boolean;
  exchange_rate_provider: string;
  theme: "dark" | "light" | "auto" | "custom";
  quote_refresh_interval: number;
  pnl_color_scheme: PnlColorScheme;
  custom_theme: CustomTheme | null;
  background_image: string | null; // base64 data URL
  background_dim: number; // 暗度遮罩 0~1
  background_blur: number; // 背景模糊像素
}

export interface Meta {
  asset_types: AssetType[];
  markets: Market[];
  currencies: Currency[];
  default_currency: Record<Market, Currency>;
  provider: string;
}

export interface SearchResult {
  asset_type: AssetType;
  market: Market;
  symbol: string;
  name: string;
  currency: Currency;
  fund_type: string | null;
}

export type HistoryRange = "7d" | "30d" | "90d" | "ytd";
export type Granularity = "day" | "week" | "month" | "year";

export interface HistoryPoint {
  date: string;
  total_pnl: number | null;
  daily_pnl: number | null;
  top_contributor: string | null;
}

export interface HistoryContribution {
  asset_id: string;
  name: string;
  value: number;
}

export interface HistoryResponse {
  from: string;
  to: string;
  granularity: Granularity;
  settlement_currency: Currency;
  is_estimated: boolean;
  fx_available: boolean;
  asset_id: string | null;
  points: HistoryPoint[];
  contributions: HistoryContribution[];
}

export interface FxRefreshStatus {
  ok: boolean;
  provider: string;
  rate_time: string | null;
  preserved_last_good: boolean;
  error?: string;
}

export interface RefreshResult {
  total: number;
  succeeded: number;
  failed: number;
  failed_assets: string[];
  refreshed_at: string;
  fx?: FxRefreshStatus;
}

export interface RevalidateResult {
  refresh: RefreshResult;
  recompute: {
    total: number;
    succeeded: number;
    skipped: number;
    failed: number;
    rows: number;
    results: { asset_id: string; status: "ok" | "skipped" | "failed"; rows: number; from: string | null; reason?: string }[];
  };
}

export interface FxRateInfo {
  from: Currency;
  to: Currency;
  rate: number;
  rate_time: string;
  provider: string;
  available: boolean;
}

export interface FxResponse {
  target: Currency;
  provider_setting: string;
  source: string | null;
  last_update: string | null;
  stale: boolean;
  rates: FxRateInfo[];
}

export interface AdminSession {
  unlocked: boolean;
  unlock_expires_at: string | null;
  token?: string;
}

export interface AdminSettingsResponse {
  display: DisplaySetting;
  security: AdminSession;
}
