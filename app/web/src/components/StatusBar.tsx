import { useEffect, useRef, useState } from "react";
import type { Currency, Holding } from "../types";
import type { RefreshState } from "../lib/usePortfolio";
import { MARKET_STATUS_COLOR, MARKET_STATUS_LABEL } from "../lib/format";
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

function updatedTimeParts(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: "—", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "—", time: "" };
  return {
    date: d.toLocaleDateString("zh-CN"),
    time: d.toLocaleTimeString("zh-CN", { hour12: false }),
  };
}

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
  const [currencyMenuOpen, setCurrencyMenuOpen] = useState(false);
  const currencyMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!currencyMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!currencyMenuRef.current?.contains(event.target as Node)) setCurrencyMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCurrencyMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [currencyMenuOpen]);

  const selectCurrency = (c: Currency) => {
    onCurrencyChange(c);
    setCurrencyMenuOpen(false);
  };
  const statusChips = marketStatuses(holdings);
  const updatedAt = updatedTimeParts(lastUpdated);

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--header-bg)] backdrop-blur-xl backdrop-saturate-[1.8] backdrop-brightness-110">
      <div className="mx-auto grid max-w-[1600px] gap-2 px-3 py-2.5 sm:flex sm:flex-wrap sm:items-center sm:gap-x-5 sm:gap-y-2.5 sm:px-5 sm:py-3">
        <div className="flex min-w-0 items-center gap-2 sm:contents">
          <button
            onClick={onHome}
            className="flex w-fit shrink-0 items-center gap-2 rounded-xl px-1 py-1 transition-colors hover:bg-[var(--surface-hover)] sm:gap-2.5"
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] ring-1 ring-[var(--accent-line)]">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 17l5-5 4 4 8-9" />
                <path d="M16 7h5v5" />
              </svg>
            </span>
            <span className="text-[16px] font-semibold tracking-tight text-[var(--text)] sm:text-[17px]">
              Track<span className="text-[var(--accent)]">Folio</span>
            </span>
          </button>
          <MarketChips chips={statusChips} className="ml-auto flex min-w-0 items-center justify-end gap-1.5 overflow-hidden sm:hidden" />
        </div>

        {/* 各市场交易状态 */}
        <MarketChips chips={statusChips} className="hidden min-w-0 items-center gap-1.5 overflow-x-auto sm:flex" />

        <div className="flex w-full min-w-0 items-center justify-end gap-2 sm:ml-auto sm:w-auto sm:gap-3">
          {/* 刷新状态 */}
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-xs sm:flex-none">
            <span className={`h-2 w-2 shrink-0 rounded-full ${REFRESH_DOT[refreshState]}`} />
            <span className={`min-w-0 truncate ${error ? "text-red-400" : "text-[var(--text-dim)]"}`}>
              {error ?? REFRESH_LABEL[refreshState]}
            </span>
            {!error && (
              <span className="tnum hidden shrink-0 flex-col leading-tight text-[10px] text-[var(--text-faint)] min-[390px]:flex sm:flex">
                <span>{updatedAt.date}</span>
                {updatedAt.time && <span>{updatedAt.time}</span>}
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 sm:contents">
            {/* 结算货币切换 */}
            <div ref={currencyMenuRef} className="relative flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-2 py-1">
              <span className="label hidden min-[420px]:inline">货币</span>
              <button
                type="button"
                onClick={() => setCurrencyMenuOpen((open) => !open)}
                className="tnum flex w-14 items-center justify-between gap-1 rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-1.5 py-0.5 text-xs font-semibold text-[var(--accent)] outline-none transition-colors hover:border-[var(--accent-line)] focus:border-[var(--accent-line)] focus:shadow-[0_0_0_3px_var(--accent-soft)]"
                aria-haspopup="listbox"
                aria-expanded={currencyMenuOpen}
                aria-label="统一结算货币"
              >
                <span>{currency}</span>
                <svg className={`h-3 w-3 text-[var(--text-faint)] transition-transform ${currencyMenuOpen ? "rotate-180" : ""}`} viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {currencyMenuOpen && (
                <div
                  role="listbox"
                  aria-label="统一结算货币"
                  className="menu-pop absolute right-2 top-[calc(100%+0.35rem)] z-30 w-14 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--tooltip-bg)] py-1 shadow-[0_14px_34px_-20px_var(--shadow-panel)] backdrop-blur-xl"
                >
                  {currencies.map((c) => {
                    const active = c === currency;
                    return (
                      <button
                        key={c}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => selectCurrency(c)}
                        className={`tnum flex w-full items-center justify-between gap-1 px-1.5 py-1.5 text-left text-xs transition-colors ${
                          active
                            ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent)]"
                            : "text-[var(--text-dim)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                        }`}
                      >
                        <span>{c}</span>
                        {active && <span className="text-[10px]">✓</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <button
              onClick={onRefresh}
              disabled={refreshState === "loading"}
              aria-label="刷新"
              className="mobile-header-action btn-ghost inline-flex shrink-0 items-center justify-center px-2.5 py-1.5 text-xs text-[var(--text)] disabled:opacity-50 sm:px-3"
            >
              <span className={`inline-block min-[380px]:mr-1 ${refreshState === "loading" ? "refresh-spin" : ""}`}>↻</span>
              <span className="hidden min-[380px]:inline">刷新</span>
            </button>

            {!isAdmin && (
              <button onClick={onOpenAdmin} aria-label="设置" className="mobile-header-action btn-ghost inline-flex shrink-0 items-center justify-center gap-1 px-2.5 py-1.5 text-xs text-[var(--text)] sm:px-3.5">
                <svg className="h-3.5 w-3.5 min-[380px]:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M9.67 4.14a2.34 2.34 0 0 1 4.66 0 2.34 2.34 0 0 0 3.32 1.91 2.34 2.34 0 0 1 2.33 4.04 2.34 2.34 0 0 0 0 3.82 2.34 2.34 0 0 1-2.33 4.04 2.34 2.34 0 0 0-3.32 1.91 2.34 2.34 0 0 1-4.66 0 2.34 2.34 0 0 0-3.32-1.91 2.34 2.34 0 0 1-2.33-4.04 2.34 2.34 0 0 0 0-3.82 2.34 2.34 0 0 1 2.33-4.04 2.34 2.34 0 0 0 3.32-1.91Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <span className="hidden min-[380px]:inline">设置</span>
              </button>
            )}
          </div>
        </div>

      </div>
    </header>
  );
}

function MarketChips({
  chips,
  className,
}: {
  chips: Array<[string, MarketStatus]>;
  className: string;
}) {
  if (chips.length === 0) return null;
  return (
    <div className={className}>
      {chips.map(([market, status]) => (
        <span key={market} className={`chip ${MARKET_STATUS_COLOR[status]}`}>
          <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
          {MARKET_NAME[market] ?? market}
          <span className="opacity-70">{MARKET_STATUS_LABEL[status]}</span>
        </span>
      ))}
    </div>
  );
}
