import type { AssetType, Currency, Market } from "../domain/types.js";

/** 标的引用（搜索结果返回给前端的最小信息） */
export interface SecurityRef {
  asset_type: AssetType;
  market: Market;
  symbol: string;
  name: string;
  currency: Currency;
  fund_type: string | null;
}
