import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Currency, Holding, Market } from "../types";
import {
  MARKET_LABEL,
  QUOTE_STATUS_COLOR,
  QUOTE_STATUS_LABEL,
  fmtMoney,
  fmtNum,
  fmtPercent,
  fmtQty,
  fmtSigned,
  fmtTime,
  pnlColor,
} from "../lib/format";
import { unitCostWithFee } from "../lib/position";

interface Props {
  holdings: Holding[];
  currency: Currency;
  showOriginal: boolean;
}

type SortKey =
  | "market_value_settled"
  | "today_pnl"
  | "today_pct"
  | "total_pnl"
  | "total_pct"
  | "updated";

const MARKET_FILTERS: Array<Market | "ALL"> = ["ALL", "CN", "US", "HK"];
const TYPE_FILTERS: Array<"ALL" | "STOCK" | "FUND"> = ["ALL", "STOCK", "FUND"];
const PAGE_SIZE_OPTIONS = [5, 10, 20] as const;

/** 终端代码徽标：取股票代码主体，去掉市场后缀，最多 5 位 */
function badgeCode(symbol: string): string {
  const core = symbol.split(/[.:]/)[0] || symbol;
  return core.slice(0, 5).toUpperCase();
}

export function HoldingsTable({ holdings, currency, showOriginal }: Props) {
  const [market, setMarket] = useState<Market | "ALL">("ALL");
  const [type, setType] = useState<"ALL" | "STOCK" | "FUND">("ALL");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("market_value_settled");
  const [asc, setAsc] = useState(false);
  const [pageSize, setPageSize] = useState<number>(5);
  const [page, setPage] = useState(1);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = holdings.filter((h) => {
      if (market !== "ALL" && h.asset.market !== market) return false;
      if (type !== "ALL" && h.asset.asset_type !== type) return false;
      if (q && !(`${h.asset.symbol} ${h.asset.name}`.toLowerCase().includes(q))) return false;
      return true;
    });
    const val = (h: Holding): number => {
      switch (sortKey) {
        case "market_value_settled":
          return h.market_value_settled ?? -Infinity;
        case "today_pnl":
          return h.today_pnl_settled ?? -Infinity;
        case "today_pct":
          return h.today_pnl.percent ?? -Infinity;
        case "total_pnl":
          return h.total_pnl_settled ?? -Infinity;
        case "total_pct":
          return h.total_pnl.percent ?? -Infinity;
        case "updated":
          return h.quote?.quote_time ? Date.parse(h.quote.quote_time) : -Infinity;
      }
    };
    list = [...list].sort((a, b) => (asc ? val(a) - val(b) : val(b) - val(a)));
    return list;
  }, [holdings, market, type, query, sortKey, asc]);

  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // 行数或筛选变化导致当前页越界时，回退到最后一页
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);
  const safePage = Math.min(page, pageCount);
  const pageRows = useMemo(
    () => rows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [rows, safePage, pageSize],
  );
  const firstIndex = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const lastIndex = Math.min(safePage * pageSize, total);

  // 切换筛选/搜索/排序时回到第一页
  useEffect(() => {
    setPage(1);
  }, [market, type, query, sortKey, asc, pageSize]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(false);
    }
  };

  const arrow = (key: SortKey) => (sortKey === key ? (asc ? " ↑" : " ↓") : "");

  // 固定高度 = 表头高 + 每页行数 × 单行高，使「满页」正好填满、不留白也不滚动
  const headRef = useRef<HTMLTableSectionElement>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const [headHeight, setHeadHeight] = useState(0);
  const [rowHeight, setRowHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (headRef.current) setHeadHeight(headRef.current.offsetHeight);
    // 仅用真实数据行测量行高；空列表时沿用上次测得的行高，保证有/无数据高度一致
    if (pageRows.length > 0) {
      const firstRow = bodyRef.current?.querySelector("tr") as HTMLElement | null;
      if (firstRow) setRowHeight(firstRow.offsetHeight);
    }
  }, [pageRows.length, showOriginal]);
  const bodyHeight = rowHeight ? rowHeight * pageSize : null;
  const listHeight = bodyHeight ? headHeight + bodyHeight : null;

  return (
    <div className="panel overflow-hidden">
      {/* 筛选栏 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] p-3">
        <Segmented
          options={MARKET_FILTERS.map((m) => [m, m === "ALL" ? "全部市场" : MARKET_LABEL[m]] as [string, string])}
          value={market}
          onChange={(v) => setMarket(v as Market | "ALL")}
        />
        <Segmented
          options={TYPE_FILTERS.map(
            (t) => [t, t === "ALL" ? "全部类型" : t === "STOCK" ? "股票" : "基金"] as [string, string],
          )}
          value={type}
          onChange={(v) => setType(v as "ALL" | "STOCK" | "FUND")}
        />
        <div className="ml-auto flex items-center gap-3">
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-600">⌕</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索代码或名称"
              className="w-52 rounded-[5px] border border-white/[0.08] bg-white/[0.03] py-1.5 pl-7 pr-2 text-xs text-slate-200 outline-none focus:border-[var(--accent-line)]"
            />
          </div>
        </div>
      </div>

      <div className="overflow-auto" style={{ height: listHeight ?? undefined }}>
        <table className="w-full min-w-[1040px] text-sm">
          <thead ref={headRef} className="sticky top-0 z-10 bg-[var(--surface-2)] backdrop-blur-xl">
            <tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-[0.08em] text-slate-500">
              <Th className="text-left">资产</Th>
              <Th>市场</Th>
              <Th className="text-right">最新价/净值</Th>
              <Th className="text-right">涨跌幅</Th>
              <Th className="text-right">持仓</Th>
              <Th className="text-right" tooltip="买入均价按交易流水加权平均，交易费用按当前持仓摊入单价">成本(含费)</Th>
              <Th className="cursor-pointer text-right hover:text-slate-300" onClick={() => toggleSort("market_value_settled")}>
                市值{arrow("market_value_settled")}
              </Th>
              <Th className="cursor-pointer text-right hover:text-slate-300" onClick={() => toggleSort("today_pnl")}>
                今日盈亏{arrow("today_pnl")}
              </Th>
              <Th className="cursor-pointer text-right hover:text-slate-300" onClick={() => toggleSort("total_pnl")}>
                总盈亏{arrow("total_pnl")}
              </Th>
              <Th className="text-right">更新时间</Th>
              <Th>状态</Th>
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {pageRows.map((h) => (
              <tr
                key={h.position.id}
                className="group border-b border-white/[0.04] transition-colors last:border-0 hover:bg-white/[0.025]"
              >
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="term-badge tnum shrink-0">{badgeCode(h.asset.symbol)}</span>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-100">{h.asset.name || h.asset.symbol}</div>
                      <div className="tnum text-xs text-slate-500">
                        {h.asset.symbol} · {h.asset.asset_type === "FUND" ? "基金" : "股票"}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <span className="chip text-slate-400">{MARKET_LABEL[h.asset.market]}</span>
                </td>
                <td className="tnum px-3 py-2.5 text-right text-slate-100">
                  {fmtNum(h.latest, h.is_nav_based ? 4 : 2)}
                  <span className="ml-1 text-xs text-slate-600">{h.currency}</span>
                </td>
                <td className={`tnum px-3 py-2.5 text-right ${pnlColor(h.quote?.change_percent)}`}>
                  {fmtPercent(h.quote?.change_percent)}
                </td>
                <td className="tnum px-3 py-2.5 text-right text-slate-300">{fmtQty(h.position.quantity)}</td>
                <td className="tnum px-3 py-2.5 text-right text-slate-400">
                  {fmtNum(unitCostWithFee(h.position), 2)}
                  <div className="text-xs text-slate-600">{h.currency}</div>
                </td>
                <td className="tnum px-3 py-2.5 text-right text-slate-100">
                  {fmtMoney(h.market_value_settled, currency)}
                  {showOriginal && h.currency !== currency && (
                    <div className="text-xs text-slate-600">{fmtMoney(h.market_value, h.currency)}</div>
                  )}
                </td>
                <td className={`tnum px-3 py-2.5 text-right ${pnlColor(h.today_pnl_settled)}`}>
                  {h.today_pnl.computable ? (
                    <>
                      {fmtSigned(h.today_pnl_settled, currency)}
                      <div className="text-xs opacity-80">{fmtPercent(h.today_pnl.percent)}</div>
                    </>
                  ) : (
                    <span className="tf-tooltip text-xs text-slate-600" data-tooltip={h.today_pnl.reason}>不可计算</span>
                  )}
                </td>
                <td className={`tnum px-3 py-2.5 text-right ${pnlColor(h.total_pnl_settled)}`}>
                  {h.total_pnl.computable ? (
                    <>
                      {fmtSigned(h.total_pnl_settled, currency)}
                      <div className="text-xs opacity-80">{fmtPercent(h.total_pnl.percent)}</div>
                    </>
                  ) : (
                    <span className="text-xs text-slate-600">不可计算</span>
                  )}
                </td>
                <td className="tnum px-3 py-2.5 text-right text-xs text-slate-600">
                  {fmtTime(h.quote?.quote_time ?? h.quote?.nav_date)}
                </td>
                <td className="px-3 py-2.5 text-center">
                  <span className={`inline-flex items-center gap-1 text-xs ${QUOTE_STATUS_COLOR[h.data_status]}`}>
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {QUOTE_STATUS_LABEL[h.data_status]}
                  </span>
                </td>
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr>
                <td
                  colSpan={11}
                  className="text-center text-sm text-slate-600"
                  style={{ height: bodyHeight ?? 220 }}
                >
                  没有匹配的持仓
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 分页栏（始终显示，避免有/无数据切换时高度跳变） */}
      <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.06] px-3 py-2.5 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="label">每页</span>
            <PageSizeSelect value={pageSize} onChange={setPageSize} />
            <span>条</span>
          </div>

          <span className="tnum text-slate-500">
            {firstIndex}–{lastIndex} / {total}
          </span>

          <div className="ml-auto flex items-center gap-1.5">
            <PageBtn disabled={safePage <= 1} onClick={() => setPage(1)}>
              «
            </PageBtn>
            <PageBtn disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              ‹
            </PageBtn>
            <span className="tnum px-1 text-slate-400">
              {safePage} / {pageCount}
            </span>
            <PageBtn disabled={safePage >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
              ›
            </PageBtn>
            <PageBtn disabled={safePage >= pageCount} onClick={() => setPage(pageCount)}>
              »
            </PageBtn>
          </div>
        </div>
    </div>
  );
}

function PageSizeSelect({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="tnum flex w-14 items-center justify-between gap-1 rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-2 py-1 text-xs font-semibold text-[var(--accent)] outline-none transition-colors hover:border-[var(--accent-line)] focus:border-[var(--accent-line)] focus:shadow-[0_0_0_3px_var(--accent-soft)]"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="每页显示条数"
      >
        <span>{value}</span>
        <svg
          className={`h-3 w-3 text-[var(--text-faint)] transition-transform ${open ? "" : "rotate-180"}`}
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden
        >
          <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="每页显示条数"
          className="menu-pop absolute bottom-[calc(100%+0.35rem)] left-0 z-30 w-14 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--tooltip-bg)] py-1 shadow-[0_14px_34px_-20px_var(--shadow-panel)] backdrop-blur-xl"
        >
          {PAGE_SIZE_OPTIONS.map((n) => {
            const active = n === value;
            return (
              <button
                key={n}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(n);
                  setOpen(false);
                }}
                className={`tnum flex w-full items-center justify-between gap-1 px-2 py-1.5 text-left text-xs transition-colors ${
                  active
                    ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent)]"
                    : "text-[var(--text-dim)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                }`}
              >
                <span>{n}</span>
                {active && <span className="text-[10px]">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PageBtn({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="tnum grid h-6 min-w-6 place-items-center rounded-[5px] border border-white/[0.08] bg-white/[0.03] px-1.5 text-slate-300 transition-colors hover:border-[var(--accent-line)] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-white/[0.08] disabled:hover:text-slate-300"
    >
      {children}
    </button>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: Array<[string, string]>;
  value: string;
  onChange: (v: string) => void;
}) {
  const activeIndex = options.findIndex(([val]) => val === value);

  return (
    <div
      className="relative grid rounded-[5px] border border-white/[0.08] bg-white/[0.02] p-0.5"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {activeIndex >= 0 && (
        <span
          aria-hidden
          className="segment-indicator absolute bottom-0.5 left-0.5 top-0.5 rounded-[3px] bg-[var(--accent)]"
          style={{
            width: `calc((100% - 4px) / ${options.length})`,
            transform: `translateX(${activeIndex * 100}%)`,
          }}
        />
      )}
      {options.map(([val, label]) => (
        <button
          key={val}
          onClick={() => onChange(val)}
          className={`relative z-10 rounded-[3px] px-2.5 py-1 text-xs tracking-wide transition-colors ${
            value === val
              ? "font-medium text-[var(--accent-contrast)]"
              : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Th({
  children,
  className = "",
  onClick,
  tooltip,
}: {
  children?: React.ReactNode;
  className?: string;
  onClick?: () => void;
  tooltip?: string;
}) {
  return (
    <th onClick={onClick} data-tooltip={tooltip} className={`tf-tooltip px-3 py-2.5 font-medium select-none ${className}`}>
      {children}
    </th>
  );
}
