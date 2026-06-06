import { useEffect, useState } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import type { Currency, HistoryRange, Holding } from "../types";
import { fmtSigned } from "../lib/format";
import { Segmented } from "./Segmented";

// 贡献图独立的时间范围：今日（用实时持仓）+ 与走势图一致的历史区间
type ContribRange = "today" | HistoryRange;

const RANGES: Array<[ContribRange, string]> = [
  ["today", "今日"],
  ["7d", "近 7 天"],
  ["30d", "近 30 天"],
  ["90d", "近 90 天"],
  ["ytd", "今年"],
];

interface ContribBar {
  name: string;
  value: number;
}

function Panel({
  title,
  action,
  children,
  empty,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  empty: boolean;
}) {
  return (
    <div className="panel p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="h-3.5 w-1 rounded-full bg-[var(--accent)]" />
        <span className="label">{title}</span>
        {action && <div className="ml-auto flex items-center gap-2">{action}</div>}
      </div>
      {empty ? (
        <div className="flex h-[220px] items-center justify-center text-xs text-[var(--text-faint)]">
          暂无数据，添加持仓后展示
        </div>
      ) : (
        <div className="h-[220px]">{children}</div>
      )}
    </div>
  );
}

function toBars(items: Array<{ name: string; value: number }>): ContribBar[] {
  return items
    .map((d) => ({ name: d.name, value: Math.round(d.value * 100) / 100 }))
    .filter((d) => d.value !== 0)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

export function Charts({ holdings, currency }: { holdings: Holding[]; currency: Currency }) {
  const [range, setRange] = useState<ContribRange>("today");
  // 历史区间的贡献数据（today 用实时持仓，不发请求）
  const [history, setHistory] = useState<ContribBar[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (range === "today") {
      setHistory(null);
      setError(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    api
      .history({ range, currency, granularity: "day" })
      .then((res) => {
        if (!alive) return;
        setHistory(toBars(res.contributions.map((c) => ({ name: c.name, value: c.value }))));
        setError(null);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "加载贡献失败");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [range, currency]);

  const todayBars = toBars(
    holdings
      .filter((h) => h.today_pnl.computable && h.today_pnl_settled != null)
      .map((h) => ({ name: h.asset.name || h.asset.symbol, value: h.today_pnl_settled ?? 0 })),
  );

  const barData = range === "today" ? todayBars : history ?? [];
  const empty = !loading && barData.length === 0;

  return (
    <Panel
      title="盈亏贡献"
      empty={empty}
      action={
        <>
          {error && <span className="text-xs text-red-400">{error}</span>}
          {loading && <span className="text-xs text-slate-500">加载中…</span>}
          <Segmented options={RANGES} value={range} onChange={setRange} />
        </>
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={barData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
          <XAxis
            dataKey="name"
            tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
            axisLine={{ stroke: "var(--chart-grid)" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            cursor={{ fill: "var(--chart-cursor)" }}
            formatter={(v: number) => fmtSigned(v, currency)}
          />
          <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={40}>
            {barData.map((d, i) => (
              <Cell key={i} fill={d.value >= 0 ? "var(--pnl-up)" : "var(--pnl-down)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  );
}

const tooltipStyle = {
  background: "var(--tooltip-bg)",
  border: "1px solid var(--tooltip-border)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--tooltip-text)",
  backdropFilter: "blur(8px)",
  boxShadow: "0 12px 30px -12px var(--shadow-panel)",
};
