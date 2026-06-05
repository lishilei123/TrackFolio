import { useMemo, useState } from "react";
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

export function HoldingsTable({ holdings, currency, showOriginal }: Props) {
  const [market, setMarket] = useState<Market | "ALL">("ALL");
  const [type, setType] = useState<"ALL" | "STOCK" | "FUND">("ALL");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("market_value_settled");
  const [asc, setAsc] = useState(false);

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

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(false);
    }
  };

  const arrow = (key: SortKey) => (sortKey === key ? (asc ? " ↑" : " ↓") : "");

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
              className="w-52 rounded-lg border border-white/[0.07] bg-white/[0.03] py-1.5 pl-7 pr-2 text-xs text-slate-200 outline-none focus:border-[var(--accent-line)]"
            />
          </div>
          <span className="label">{rows.length} 条</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-[0.08em] text-slate-500">
              <Th className="text-left">资产</Th>
              <Th>市场</Th>
              <Th className="text-right">最新价/净值</Th>
              <Th className="text-right">涨跌幅</Th>
              <Th className="text-right">持仓</Th>
              <Th className="text-right" title="按买卖交易加权平均自动计算">成本(均)</Th>
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
          <tbody>
            {rows.map((h) => (
              <tr
                key={h.position.id}
                className="group border-b border-white/[0.04] transition-colors last:border-0 hover:bg-white/[0.025]"
              >
                <td className="px-3 py-2.5">
                  <div className="font-medium text-slate-100">{h.asset.name || h.asset.symbol}</div>
                  <div className="tnum text-xs text-slate-500">
                    {h.asset.symbol} · {h.asset.asset_type === "FUND" ? "基金" : "股票"}
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
                <td className="tnum px-3 py-2.5 text-right text-slate-400">{fmtNum(h.position.avg_cost, 2)}</td>
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
                    <span className="text-xs text-slate-600" title={h.today_pnl.reason}>不可计算</span>
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
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-12 text-center text-sm text-slate-600">
                  没有匹配的持仓
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
  return (
    <div className="flex gap-0.5 rounded-lg border border-white/[0.07] bg-white/[0.02] p-0.5">
      {options.map(([val, label]) => (
        <button
          key={val}
          onClick={() => onChange(val)}
          className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
            value === val
              ? "bg-[var(--accent)] font-medium text-[#04201c]"
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
  title,
}: {
  children?: React.ReactNode;
  className?: string;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <th onClick={onClick} title={title} className={`px-3 py-2.5 font-medium select-none ${className}`}>
      {children}
    </th>
  );
}
