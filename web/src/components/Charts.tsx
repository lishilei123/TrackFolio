import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Currency, Holding } from "../types";
import { fmtSigned } from "../lib/format";

function Panel({ title, children, empty }: { title: string; children: React.ReactNode; empty: boolean }) {
  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="h-3.5 w-1 rounded-full bg-[var(--accent)]" />
        <span className="label">{title}</span>
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

export function Charts({ holdings, currency }: { holdings: Holding[]; currency: Currency }) {
  const barData = holdings
    .filter((h) => h.today_pnl.computable && h.today_pnl_settled != null)
    .map((h) => ({
      name: h.asset.name || h.asset.symbol,
      value: Math.round((h.today_pnl_settled ?? 0) * 100) / 100,
    }))
    .sort((a, b) => b.value - a.value);

  return (
    <Panel title="今日盈亏贡献" empty={barData.length === 0}>
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
