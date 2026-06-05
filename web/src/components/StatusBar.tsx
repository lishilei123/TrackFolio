import type { Currency, Holding } from "../types";
import type { RefreshState } from "../lib/usePortfolio";
import { MARKET_STATUS_COLOR, MARKET_STATUS_LABEL, fmtTime } from "../lib/format";
import type { MarketStatus } from "../types";

interface Props {
  currency: Currency;
  currencies: Currency[];
  onCurrencyChange: (c: Currency) => void;
  refreshState: RefreshState;
  lastUpdated: string | null;
  error: string | null;
  holdings: Holding[];
  onRefresh: () => void;
  onOpenAdmin: () => void;
  onHome: () => void;
  isAdmin?: boolean;
}

const REFRESH_LABEL: Record<RefreshState, string> = {
  idle: "待刷新",
  loading: "刷新中",
  success: "已更新",
  error: "刷新失败",
};

const REFRESH_DOT: Record<RefreshState, string> = {
  idle: "bg-slate-500",
  loading: "bg-[var(--accent)] animate-pulse shadow-[0_0_8px_var(--accent)]",
  success: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]",
  error: "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]",
};

function marketStatuses(holdings: Holding[]): Array<[string, MarketStatus]> {
  const map = new Map<string, MarketStatus>();
  for (const h of holdings) {
    const ms = h.quote?.market_status ?? "unknown";
    if (!map.has(h.asset.market)) map.set(h.asset.market, ms);
  }
  return [...map.entries()];
}

const MARKET_NAME: Record<string, string> = { CN: "A股", US: "美股", HK: "港股" };

export function StatusBar({
  currency,
  currencies,
  onCurrencyChange,
  refreshState,
  lastUpdated,
  error,
  holdings,
  onRefresh,
  onOpenAdmin,
  onHome,
  isAdmin = false,
}: Props) {
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--header-bg)] backdrop-blur-xl backdrop-saturate-[1.8] backdrop-brightness-110">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-5 gap-y-2.5 px-5 py-3">
        <button
          onClick={onHome}
          className="flex items-center gap-2.5 rounded-xl px-1 py-1 transition-colors hover:bg-[var(--surface-hover)]"
          title="返回主屏"
        >
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] ring-1 ring-[var(--accent-line)]">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 17l5-5 4 4 8-9" />
              <path d="M16 7h5v5" />
            </svg>
          </span>
          <span className="text-[17px] font-semibold tracking-tight text-[var(--text)]">
            Track<span className="text-[var(--accent)]">Folio</span>
          </span>
        </button>

        {/* 各市场交易状态 */}
        <div className="flex items-center gap-1.5">
          {marketStatuses(holdings).map(([market, status]) => (
            <span
              key={market}
              className={`chip ${MARKET_STATUS_COLOR[status]}`}
              title={`${MARKET_NAME[market] ?? market} · ${MARKET_STATUS_LABEL[status]}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
              {MARKET_NAME[market] ?? market}
              <span className="opacity-70">{MARKET_STATUS_LABEL[status]}</span>
            </span>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {/* 刷新状态 */}
          <div className="flex items-center gap-2 text-xs">
            <span className={`h-2 w-2 rounded-full ${REFRESH_DOT[refreshState]}`} />
            <span className={error ? "text-red-400" : "text-[var(--text-dim)]"}>
              {error ?? REFRESH_LABEL[refreshState]}
            </span>
            <span className="tnum text-[var(--text-faint)]">{fmtTime(lastUpdated)}</span>
          </div>

          {/* 结算货币切换 */}
          <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-2 py-1">
            <span className="label">结算</span>
            <select
              value={currency}
              onChange={(e) => onCurrencyChange(e.target.value as Currency)}
              className="bg-transparent text-xs font-medium text-slate-100 outline-none"
              title="统一结算货币"
            >
              {currencies.map((c) => (
                <option key={c} value={c} className="bg-[var(--bg-1)]">
                  {c}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={onRefresh}
            disabled={refreshState === "loading"}
            className="btn-ghost px-3 py-1.5 text-xs text-[var(--text)] disabled:opacity-50"
          >
            <span className={`mr-1 inline-block ${refreshState === "loading" ? "animate-spin" : ""}`}>↻</span>
            刷新
          </button>

          {!isAdmin && (
            <button onClick={onOpenAdmin} className="btn-ghost px-3.5 py-1.5 text-xs text-[var(--text)]">
              设置
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
