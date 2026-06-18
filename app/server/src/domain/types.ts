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

/** 涨跌配色：green_up 绿涨红跌 / red_up 红涨绿跌 / custom 自定义 */
export type PnlColorScheme = "green_up" | "red_up" | "custom";

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
  settlement_timezone: string;
  show_original_currency: boolean;
  use_us_premarket_pnl: boolean;
  use_us_postmarket_pnl: boolean;
  exchange_rate_provider: string;
  theme: "dark" | "light" | "auto" | "custom";
  quote_refresh_interval: number; // 秒
  pnl_color_scheme: PnlColorScheme;
  pnl_up_color: string;
  pnl_down_color: string;
  pnl_flat_color: string;
  custom_theme: CustomTheme | null;
  background_image: string | null; // base64 data URL，null 表示无背景图
  background_dim: number; // 暗度遮罩 0~1
  background_blur: number; // 背景模糊像素
  updated_at: string;
}

/** 统一资产标识，例如 STOCK:CN:600519 */
export function assetKey(a: Pick<Asset, "asset_type" | "market" | "symbol">): string {
  return `${a.asset_type}:${a.market}:${a.symbol}`;
}
