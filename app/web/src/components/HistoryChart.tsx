import { useEffect, useState } from "react";
import {
  Area,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api";
import { fmtSigned } from "../lib/format";
import { usePrefersReducedMotion } from "../lib/motion";
import type { Currency, Granularity, HistoryPoint, HistoryRange, HistoryResponse, Holding } from "../types";
import { Segmented } from "./Segmented";

const PNL_UP = "var(--pnl-up)"; // 涨（绿，终端配色，与持仓表一致）
const PNL_DOWN = "var(--pnl-down)"; // 跌（红）
const ACCENT = "var(--accent)"; // 累计曲线（teal 强调色）

const RANGES: Array<[HistoryRange, string]> = [
  ["7d", "近 7 天"],
  ["30d", "近 30 天"],
  ["90d", "近 90 天"],
  ["ytd", "今年"],
];

// 按范围选择聚合粒度：≤90 天看每日，今年聚合到周
const GRANULARITY: Record<HistoryRange, Granularity> = {
  "7d": "day",
  "30d": "day",
  "90d": "day",
  ytd: "week",
};

function fmtAxisDate(date: string, g: Granularity): string {
  if (g === "year") return date.slice(0, 4);
  if (g === "month") return date.slice(0, 7);
  return date.slice(5); // MM-DD
}

const tooltipStyle: React.CSSProperties = {
  background: "var(--tooltip-bg)",
  border: "1px solid var(--tooltip-border)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--tooltip-text)",
  backdropFilter: "blur(8px)",
  boxShadow: "0 12px 30px -12px var(--shadow-panel)",
};

export function HistoryChart({
  currency,
  holdings,
  selectedDate = null,
  onSelectDay,
}: {
  currency: Currency;
  holdings: Holding[];
  selectedDate?: string | null;
  onSelectDay?: (date: string, granularity: Granularity) => void;
}) {
  const [range, setRange] = useState<HistoryRange>("90d");
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .history({ range, currency, granularity: GRANULARITY[range] })
      .then((res) => {
        if (!alive) return;
        setData(res);
        setError(null);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "加载历史失败");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [range, currency]);

  const points = data?.points ?? [];
  const granularity = data?.granularity ?? "day";
  const empty = !loading && points.length === 0;
  const emptyText = historyEmptyText(holdings);

  return (
    <div className="panel p-3.5 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="h-3.5 w-1 rounded-full bg-[var(--accent)]" />
        <span className="label">账户盈亏走势</span>
        {data?.is_estimated && (
          <span
            className="tf-tooltip chip text-slate-500"
            data-tooltip="历史曲线按当前持仓数量 × 历史价格估算，跨币种用即时汇率折算"
          >
            估算
          </span>
        )}
        {data && !data.fx_available && (
          <span className="chip text-amber-400">汇率部分不可用</span>
        )}
        <div className="flex w-full min-w-0 items-center gap-2 overflow-x-auto sm:ml-auto sm:w-auto">
          {error && <span className="text-xs text-red-400">{error}</span>}
          <Segmented options={RANGES} value={range} onChange={setRange} />
        </div>
      </div>

      {empty ? (
        <div className="flex h-[230px] items-center justify-center text-xs text-slate-600 sm:h-[260px]">
          {emptyText}
        </div>
      ) : (
        <div className={`h-[230px] sm:h-[260px] ${onSelectDay ? "cursor-pointer" : ""}`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={points}
              margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
              onClick={(e: { activePayload?: Array<{ payload: HistoryPoint }> }) => {
                const date = e?.activePayload?.[0]?.payload?.date;
                if (date) onSelectDay?.(date, granularity);
              }}
            >
              <defs>
                <linearGradient id="tf-pnl-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ACCENT} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => fmtAxisDate(d, granularity)}
                tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
                axisLine={{ stroke: "var(--chart-grid)" }}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis
                tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={56}
                tickFormatter={(v: number) => compact(v)}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                cursor={{ fill: "var(--chart-cursor)" }}
                content={<HistoryTooltip currency={currency} granularity={granularity} />}
              />
              <Area
                type="monotone"
                dataKey="total_pnl"
                stroke="none"
                fill="url(#tf-pnl-area)"
                isAnimationActive={false}
                activeDot={false}
              />
              <Line
                key={`${range}-${currency}-${points.length}`}
                type="monotone"
                dataKey="total_pnl"
                name="累计盈亏"
                stroke={ACCENT}
                strokeWidth={2}
                dot={<SelectedDot selectedDate={selectedDate} />}
                activeDot={{ r: 4, fill: ACCENT }}
                isAnimationActive={!reducedMotion}
                animationBegin={80}
                animationDuration={650}
                animationEasing="ease-out"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function historyEmptyText(holdings: Holding[]): string {
  if (holdings.length === 0) return "暂无数据，添加持仓后展示";
  const hasQuote = holdings.some((h) => h.latest != null || h.quote != null);
  if (!hasQuote) return "行情数据不足，刷新或校验后展示";
  return "暂无历史快照，点击后台校验后展示";
}

/** 走势节点：选中日画放大描边点，其余维持小圆点 */
function SelectedDot(props: {
  cx?: number;
  cy?: number;
  payload?: HistoryPoint;
  selectedDate?: string | null;
}) {
  const { cx, cy, payload, selectedDate } = props;
  if (cx == null || cy == null) return null;
  const active = selectedDate != null && payload?.date === selectedDate;
  if (active) {
    return (
      <circle cx={cx} cy={cy} r={5} fill={ACCENT} stroke="var(--surface)" strokeWidth={2} />
    );
  }
  return <circle cx={cx} cy={cy} r={2.5} fill={ACCENT} />;
}

/** 紧凑数字（万/k）用于 Y 轴 */
function compact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 10000) return `${(v / 10000).toFixed(1)}万`;
  if (abs >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(Math.round(v));
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: HistoryPoint }>;
  label?: string;
  currency: Currency;
  granularity: Granularity;
}

function HistoryTooltip({ active, payload, currency, granularity }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  const dateLabel = granularity === "week" ? `${p.date} 起当周` : p.date;
  return (
    <div style={tooltipStyle} className="px-3 py-2">
      <div className="mb-1 text-xs text-[var(--text-dim)]">{dateLabel}</div>
      <Row label="累计盈亏" value={fmtSigned(p.total_pnl, currency)} color={pnlHex(p.total_pnl)} />
      <Row label="当期盈亏" value={fmtSigned(p.daily_pnl, currency)} color={pnlHex(p.daily_pnl)} />
      {p.top_contributor && (
        <div className="mt-1 text-[11px] text-[var(--text-faint)]">主要贡献：{p.top_contributor}</div>
      )}
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="text-[var(--text-dim)]">{label}</span>
      <span className="tnum font-medium" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

function pnlHex(v: number | null): string {
  if (v == null || v === 0) return "var(--pnl-flat)";
  return v > 0 ? PNL_UP : PNL_DOWN;
}
