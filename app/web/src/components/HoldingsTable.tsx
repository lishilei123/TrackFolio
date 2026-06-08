import { useEffect, useMemo, useState } from "react";
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
import { PaginationBar, useFixedTableHeight, usePagination } from "./Pagination";

interface Props {
  holdings: Holding[];
  currency: Currency;
  showOriginal: boolean;
}

type SortKey =
  | "latest"
  | "change_percent"
  | "quantity"
  | "unit_cost"
  | "market_value_settled"
  | "today_pnl"
  | "today_pct"
  | "total_pnl"
  | "total_pct"
  | "updated";

const MARKET_FILTERS: Array<Market | "ALL"> = ["ALL", "CN", "US", "HK"];

/** 终端代码徽标：取股票代码主体，去掉市场后缀，最多 5 位 */
function badgeCode(symbol: string): string {
  const core = symbol.split(/[.:]/)[0] || symbol;
  return core.slice(0, 5).toUpperCase();
}

export function HoldingsTable({ holdings, currency, showOriginal }: Props) {
  const [market, setMarket] = useState<Market | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [asc, setAsc] = useState(false);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = holdings.filter((h) => {
      if (market !== "ALL" && h.asset.market !== market) return false;
      if (q && !(`${h.asset.symbol} ${h.asset.name}`.toLowerCase().includes(q))) return false;
      return true;
    });
    if (!sortKey) return list;
    const key = sortKey;
    const val = (h: Holding): number => {
      switch (key) {
        case "latest":
          return h.latest ?? -Infinity;
        case "change_percent":
          return h.quote?.change_percent ?? -Infinity;
        case "quantity":
          return h.position.quantity ?? -Infinity;
        case "unit_cost":
          return unitCostWithFee(h.position) ?? -Infinity;
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
    return [...list].sort((a, b) => (asc ? val(a) - val(b) : val(b) - val(a)));
  }, [holdings, market, query, sortKey, asc]);

  const total = rows.length;
  const { page, setPage, pageSize, setPageSize, pageCount, firstIndex, lastIndex } = usePagination(total);
  const pageRows = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize],
  );

  // 切换筛选/搜索/排序时回到第一页
  useEffect(() => {
    setPage(1);
  }, [market, query, sortKey, asc, pageSize, setPage]);

  const toggleSort = (key: SortKey) => {
    // 三态循环：降序 → 升序 → 取消排序（恢复默认顺序）
    if (sortKey !== key) {
      setSortKey(key);
      setAsc(false);
    } else if (!asc) {
      setAsc(true);
    } else {
      setSortKey(null);
      setAsc(false);
    }
  };

  const arrow = (key: SortKey) => (sortKey === key ? (asc ? " ↑" : " ↓") : "");

  const { headRef, bodyRef, bodyHeight, listHeight } = useFixedTableHeight(pageRows.length, pageSize, [showOriginal]);

  return (
    <div className="panel overflow-hidden">
      {/* 筛选栏 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] p-3">
        <Segmented
          options={MARKET_FILTERS.map((m) => [m, m === "ALL" ? "全部市场" : MARKET_LABEL[m]] as [string, string])}
          value={market}
          onChange={(v) => setMarket(v as Market | "ALL")}
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
              <Th className="cursor-pointer text-right hover:text-slate-300" onClick={() => toggleSort("latest")}>
                最新价/净值{arrow("latest")}
              </Th>
              <Th className="cursor-pointer text-right hover:text-slate-300" onClick={() => toggleSort("change_percent")}>
                涨跌幅{arrow("change_percent")}
              </Th>
              <Th className="cursor-pointer text-right hover:text-slate-300" onClick={() => toggleSort("quantity")}>
                持仓{arrow("quantity")}
              </Th>
              <Th
                className="cursor-pointer text-right hover:text-slate-300"
                tooltip="买入均价按交易流水加权平均，交易费用按当前持仓摊入单价"
                onClick={() => toggleSort("unit_cost")}
              >
                成本(含费){arrow("unit_cost")}
              </Th>
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
            {pageRows.map((h, i) => (
              <tr
                key={h.position.id}
                className="data-row group border-b border-white/[0.04] transition-colors last:border-0 hover:bg-white/[0.025]"
                style={{ animationDelay: `${Math.min(i * 16, 120)}ms` }}
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
      <PaginationBar
        page={page}
        pageCount={pageCount}
        pageSize={pageSize}
        total={total}
        firstIndex={firstIndex}
        lastIndex={lastIndex}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </div>
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
