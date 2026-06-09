import { useEffect, useState } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import type { Currency, Granularity, HistoryRange, Holding, MarketStatus } from "../types";
import { fmtSigned } from "../lib/format";
import { usePrefersReducedMotion } from "../lib/motion";
import { dateInTimeZone, settlementToday } from "../lib/timezone";
import { Segmented } from "./Segmented";

// 贡献图独立的时间范围：今日（用实时持仓）+ 与走势图一致的历史区间
type ContribRange = "today" | HistoryRange;
type SelectedDay = { date: string; granularity: Granularity } | null;

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
  heading,
  badge,
  action,
  children,
  empty,
  emptyText,
}: {
  heading: string;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  empty: boolean;
  emptyText: string;
}) {
  return (
    <div className="panel p-3.5 sm:p-4">
      <div className="mb-3 space-y-2 sm:flex sm:items-center sm:gap-2 sm:space-y-0">
        <div className="flex min-h-[24px] min-w-0 items-center gap-2">
          <span className="h-3.5 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
          <span className="label shrink-0">{heading}</span>
          <span className="flex min-h-[24px] min-w-[104px] items-center">
            {badge}
          </span>
        </div>
        {action && <div className="flex w-full min-w-0 items-center gap-2 overflow-x-auto sm:ml-auto sm:w-auto">{action}</div>}
      </div>
      {empty ? (
        <div className="flex h-[210px] items-center justify-center text-xs text-[var(--text-faint)] sm:h-[220px]">
          {emptyText}
        </div>
      ) : (
        <div className="h-[210px] sm:h-[220px]">{children}</div>
      )}
    </div>
  );
}

/** YYYY-MM-DD 加 n 天（UTC，避免时区漂移） */
function addDays(date: string, n: number): string {
  const t = Date.parse(date + "T00:00:00.000Z");
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10);
}

function settlementDateFromInstant(value: string | null | undefined, timeZone: string): string | null {
  if (!value) return null;
  const direct = value.match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
  return direct ?? dateInTimeZone(value, timeZone);
}

function isBeforeOpen(status: MarketStatus | undefined): boolean {
  return status === "pre" || status === "unknown";
}

function todayEmptyText(holdings: Holding[], settlementTimezone: string): string {
  if (holdings.length === 0) return "暂无数据，添加持仓后展示";
  const today = settlementToday(settlementTimezone);
  const hasOpen = holdings.some((h) => h.quote?.market_status === "open");
  const allQuoteBeforeToday = holdings.every((h) => {
    const quoteDate = settlementDateFromInstant(h.quote?.quote_time, settlementTimezone);
    return quoteDate != null && quoteDate < today;
  });
  const anyQuoteBeforeToday = holdings.some((h) => {
    const quoteDate = settlementDateFromInstant(h.quote?.quote_time, settlementTimezone);
    return quoteDate != null && quoteDate < today;
  });
  const hasBeforeOpen = holdings.some((h) => isBeforeOpen(h.quote?.market_status));
  const allBeforeOpen = holdings.every((h) => isBeforeOpen(h.quote?.market_status));
  const computable = holdings.filter((h) => h.today_pnl.computable);
  const allComputableZero = computable.length > 0 && computable.every((h) => (h.today_pnl_settled ?? h.today_pnl.amount ?? 0) === 0);

  if (allQuoteBeforeToday && !hasBeforeOpen) return "今日休市，暂无今日盈亏数据";
  if (!hasOpen && allBeforeOpen) return "未开盘，暂无今日盈亏数据";
  if (!hasOpen && anyQuoteBeforeToday && hasBeforeOpen) return "未开盘，暂无今日盈亏数据";
  if (allComputableZero) return "今日暂无盈亏波动";
  return "行情数据不足，等待刷新或点击校验";
}

function contributionEmptyText(
  holdings: Holding[],
  range: ContribRange,
  selectedDay: { date: string; granularity: Granularity } | null,
  settlementTimezone: string,
): string {
  if (holdings.length === 0) return "暂无数据，添加持仓后展示";
  if (selectedDay) return selectedDay.date === settlementToday(settlementTimezone) ? todayEmptyText(holdings, settlementTimezone) : "所选日期暂无盈亏数据";
  if (range === "today") return todayEmptyText(holdings, settlementTimezone);
  return "该区间暂无盈亏数据";
}

function toBars(items: Array<{ name: string; value: number }>): ContribBar[] {
  return items
    .map((d) => ({ name: d.name, value: Math.round(d.value * 100) / 100 }))
    .filter((d) => d.value !== 0)
    .sort((a, b) => b.value - a.value);
}

function contributionValueLabel(range: ContribRange, selectedDay: SelectedDay, isTodaySelected: boolean): string {
  if (selectedDay) {
    if (isTodaySelected) return "今日盈亏";
    return selectedDay.granularity === "week" ? "当周盈亏" : "当日盈亏";
  }
  if (range === "7d") return "近 7 天盈亏";
  if (range === "30d") return "近 30 天盈亏";
  if (range === "90d") return "近 90 天盈亏";
  if (range === "ytd") return "今年盈亏";
  return "今日盈亏";
}

export function Charts({
  holdings,
  currency,
  settlementTimezone,
  selectedDay,
  onClearDay,
}: {
  holdings: Holding[];
  currency: Currency;
  settlementTimezone: string;
  selectedDay: SelectedDay;
  onClearDay: () => void;
}) {
  const [range, setRange] = useState<ContribRange>("today");
  // 历史区间的贡献数据（today 用实时持仓，不发请求）
  const [history, setHistory] = useState<ContribBar[] | null>(null);
  // 走势图选中日（含周粒度的整周）的贡献数据
  const [dayBars, setDayBars] = useState<ContribBar[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  const dayMode = selectedDay != null;
  // 「今日」节点（day 粒度）的当日盈亏只能取实时持仓：收盘前后端无当日快照，custom 查询会返回空
  const isTodaySelected =
    selectedDay != null && selectedDay.granularity === "day" && selectedDay.date === settlementToday(settlementTimezone);

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

  // 选中走势节点：拉取该日（周粒度取整周）的各资产贡献
  useEffect(() => {
    // 今日特例走实时持仓（todayBars），不发请求
    if (!selectedDay || isTodaySelected) {
      setDayBars(null);
      return;
    }
    const { date, granularity } = selectedDay;
    const to = granularity === "week" ? addDays(date, 6) : date;
    let alive = true;
    setLoading(true);
    api
      .history({ range: "custom", from: date, to, currency, granularity: "day" })
      .then((res) => {
        if (!alive) return;
        setDayBars(toBars(res.contributions.map((c) => ({ name: c.name, value: c.value }))));
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
  }, [selectedDay, currency, isTodaySelected]);

  const todayBars = toBars(
    holdings
      .filter((h) => h.today_pnl.computable && h.today_pnl_settled != null)
      .map((h) => ({ name: h.asset.name || h.asset.symbol, value: h.today_pnl_settled ?? 0 })),
  );

  const barData = dayMode
    ? isTodaySelected
      ? todayBars
      : dayBars ?? []
    : range === "today"
      ? todayBars
      : history ?? [];
  const empty = !loading && barData.length === 0;
  const emptyText = contributionEmptyText(holdings, range, selectedDay, settlementTimezone);
  const tooltipValueLabel = contributionValueLabel(range, selectedDay, isTodaySelected);

  const dayLabel =
    selectedDay &&
    (isTodaySelected
      ? `今日 ${selectedDay.date}`
      : selectedDay.granularity === "week"
        ? `${selectedDay.date} 起当周`
        : selectedDay.date);

  return (
    <Panel
      heading="盈亏分析"
      empty={empty}
      emptyText={emptyText}
      badge={
        dayMode && (
          <button
            onClick={onClearDay}
            className="chip flex items-center gap-1 text-[var(--accent)] hover:text-[var(--text)]"
          >
            {dayLabel}
            <span className="text-slate-500">×</span>
          </button>
        )
      }
      action={
        <>
          {error && <span className="text-xs text-red-400">{error}</span>}
          <Segmented
            options={RANGES}
            value={dayMode ? ("" as ContribRange) : range}
            onChange={(v) => {
              onClearDay();
              setRange(v);
            }}
          />
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
            cursor={{ fill: "var(--chart-cursor)" }}
            content={<ContributionTooltip currency={currency} valueLabel={tooltipValueLabel} />}
          />
          <Bar
            dataKey="value"
            radius={[3, 3, 0, 0]}
            maxBarSize={40}
            isAnimationActive={!reducedMotion}
            animationBegin={80}
            animationDuration={500}
            animationEasing="ease-out"
          >
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

interface ContributionTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: ContribBar }>;
  currency: Currency;
  valueLabel: string;
}

function ContributionTooltip({ active, payload, currency, valueLabel }: ContributionTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const bar = payload[0].payload;
  if (!bar) return null;
  const color = bar.value > 0 ? "var(--pnl-up)" : bar.value < 0 ? "var(--pnl-down)" : "var(--pnl-flat)";

  return (
    <div style={tooltipStyle} className="min-w-[168px] max-w-[260px] px-3 py-2">
      <div className="break-words text-xs leading-snug text-[var(--text-dim)]">{bar.name}</div>
      <div className="mt-1.5 flex items-center justify-between gap-5 text-xs">
        <span className="text-[var(--text-faint)]">{valueLabel}</span>
        <span className="tnum text-sm font-semibold" style={{ color }}>
          {fmtSigned(bar.value, currency)}
        </span>
      </div>
    </div>
  );
}
