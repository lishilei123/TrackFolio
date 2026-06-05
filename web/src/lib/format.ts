import type { Currency, MarketStatus, QuoteStatus } from "../types";

const CURRENCY_SYMBOL: Record<Currency, string> = {
  CNY: "¥",
  USD: "$",
  HKD: "HK$",
};

export function fmtMoney(value: number | null | undefined, currency?: Currency): string {
  if (value == null || Number.isNaN(value)) return "—";
  const sym = currency ? CURRENCY_SYMBOL[currency] : "";
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${value < 0 ? "-" : ""}${sym}${formatted}`;
}

/** 带正负号的金额，用于盈亏 */
export function fmtSigned(value: number | null | undefined, currency?: Currency): string {
  if (value == null || Number.isNaN(value)) return "—";
  const sym = currency ? CURRENCY_SYMBOL[currency] : "";
  const abs = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${sym}${abs}`;
}

export function fmtPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function fmtNum(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtQty(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

/** 正负盈亏的颜色 class（绿涨红跌可按需调整，这里红涨绿跌更贴近 A 股习惯） */
export function pnlColor(value: number | null | undefined): string {
  if (value == null || value === 0) return "text-[var(--pnl-flat)]";
  return value > 0 ? "text-[var(--pnl-up)]" : "text-[var(--pnl-down)]";
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-CN", { hour12: false });
}

export const MARKET_STATUS_LABEL: Record<MarketStatus, string> = {
  pre: "盘前",
  open: "盘中",
  post: "盘后",
  closed: "休市",
  delayed: "延迟",
  unknown: "未知",
};

export const MARKET_STATUS_COLOR: Record<MarketStatus, string> = {
  open: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  pre: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  post: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  delayed: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  closed: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  unknown: "bg-slate-500/15 text-slate-400 border-slate-500/30",
};

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  ok: "正常",
  stale: "延迟",
  unavailable: "不可用",
  estimated: "估算",
};

export const QUOTE_STATUS_COLOR: Record<QuoteStatus, string> = {
  ok: "text-emerald-400",
  stale: "text-amber-400",
  unavailable: "text-red-400",
  estimated: "text-sky-400",
};

export const MARKET_LABEL: Record<string, string> = {
  CN: "A股",
  US: "美股",
  HK: "港股",
};
