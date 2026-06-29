import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Sector, Tooltip } from "recharts";
import type { Currency, Holding } from "../types";
import { fmtMoney, fmtPercent } from "../lib/format";
import { usePrefersReducedMotion } from "../lib/motion";

interface Props {
  holdings: Holding[];
  currency: Currency;
}

interface AllocationSlice {
  id: string;
  name: string;
  symbol: string;
  market: string;
  value: number;
  percent: number;
  color: string;
}

interface ActiveShapeProps {
  cx?: number;
  cy?: number;
  innerRadius?: number;
  outerRadius?: number;
  startAngle?: number;
  endAngle?: number;
  fill?: string;
  payload?: AllocationSlice;
}

const COLORS = [
  "var(--accent)",
  "var(--pnl-up)",
  "var(--pnl-down)",
  "color-mix(in srgb, var(--accent) 72%, var(--pnl-up))",
  "color-mix(in srgb, var(--accent) 68%, var(--pnl-down))",
  "color-mix(in srgb, var(--pnl-up) 68%, var(--text-dim))",
  "color-mix(in srgb, var(--pnl-down) 62%, var(--text-dim))",
  "color-mix(in srgb, var(--accent) 58%, var(--text-dim))",
  "color-mix(in srgb, var(--chart-axis) 82%, var(--accent))",
  "color-mix(in srgb, var(--text-faint) 86%, var(--accent))",
];
const VISIBLE_LEGEND_ITEMS = 5;
const ALLOCATION_AUTOPLAY_INTERVAL_MS = 2600;
const tooltipStyle: CSSProperties = {
  background: "var(--tooltip-bg)",
  border: "1px solid var(--tooltip-border)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--tooltip-text)",
  backdropFilter: "blur(8px)",
  boxShadow: "0 12px 30px -12px var(--shadow-panel)",
};

function colorFor(symbol: string): string {
  let hash = 0;
  for (let i = 0; i < symbol.length; i += 1) hash = (hash * 31 + symbol.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length];
}

function isPositiveFinite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function renderActiveShape(props: ActiveShapeProps) {
  const outerRadius = props.outerRadius ?? 0;
  return (
    <g style={{ filter: "drop-shadow(0 10px 18px var(--shadow-panel))" }}>
      <Sector
        cx={props.cx}
        cy={props.cy}
        innerRadius={props.innerRadius}
        outerRadius={outerRadius + 5}
        startAngle={props.startAngle}
        endAngle={props.endAngle}
        fill={props.fill}
        stroke="var(--surface-2)"
        strokeWidth={2}
      />
    </g>
  );
}

function AllocationTooltip({ active, payload, currency }: { active?: boolean; payload?: Array<{ payload: AllocationSlice }>; currency: Currency }) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  return (
    <div style={tooltipStyle} className="min-w-[168px] max-w-[260px] px-3 py-2">
      <div className="font-medium text-[var(--text)]">{item.name}</div>
      <div className="tnum mt-1 text-[var(--text-dim)]">{item.symbol} · {item.market}</div>
      <div className="tnum mt-2">市值 {fmtMoney(item.value, currency)}</div>
      <div className="tnum mt-1">占比 {fmtPercent(item.percent * 100)}</div>
    </div>
  );
}

export function HoldingsAllocationChart({ holdings, currency }: Props) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [legendStartIndex, setLegendStartIndex] = useState<number | null>(null);
  const [cycleIndex, setCycleIndex] = useState(0);
  const [autoplayPaused, setAutoplayPaused] = useState(false);
  const { slices, total } = useMemo(() => {
    const rows = holdings
      .map((holding) => ({ holding, value: holding.market_value_settled }))
      .filter((row): row is { holding: Holding; value: number } => isPositiveFinite(row.value));
    const sum = rows.reduce((acc, row) => acc + row.value, 0);

    if (sum <= 0) return { slices: [] as AllocationSlice[], total: 0 };

    return {
      total: sum,
      slices: rows
        .map(({ holding, value }) => {
          const symbol = holding.asset.symbol;
          return {
            id: holding.position.id,
            name: holding.asset.name || symbol,
            symbol,
            market: holding.asset.market,
            value,
            percent: value / sum,
            color: colorFor(symbol),
          };
        })
        .sort((a, b) => b.value - a.value),
    };
  }, [holdings]);

  const legendScrollable = slices.length > VISIBLE_LEGEND_ITEMS;
  const autoplayEnabled = !prefersReducedMotion && slices.length > 1;
  const activeSlice = activeIndex == null ? null : slices[activeIndex] ?? null;
  const legendSlices = useMemo(() => {
    if (!legendScrollable || legendStartIndex == null) return slices;
    const start = Math.max(0, Math.min(legendStartIndex, slices.length - 1));
    return [...slices.slice(start), ...slices.slice(0, start)];
  }, [legendScrollable, legendStartIndex, slices]);
  const activateSlice = (index: number, rotateLegend: boolean) => {
    const nextIndex = index >= 0 ? index : null;
    setActiveIndex(nextIndex);
    if (nextIndex != null) setCycleIndex(nextIndex);
    if (rotateLegend) setLegendStartIndex(legendScrollable && nextIndex != null ? nextIndex : null);
  };
  const pauseAutoplay = () => {
    setAutoplayPaused(true);
  };
  const resumeAutoplay = () => {
    setAutoplayPaused(false);
    if (!autoplayEnabled) {
      setActiveIndex(null);
      setLegendStartIndex(null);
    }
  };
  const clearChartHover = () => {
    resumeAutoplay();
  };

  useEffect(() => {
    if (slices.length === 0) {
      setCycleIndex(0);
      setActiveIndex(null);
      setLegendStartIndex(null);
      return;
    }

    setCycleIndex((index) => Math.min(index, slices.length - 1));
  }, [slices.length]);

  useEffect(() => {
    if (!autoplayEnabled || autoplayPaused) return;

    const nextIndex = cycleIndex < slices.length ? cycleIndex : 0;
    setActiveIndex(nextIndex);
    setLegendStartIndex(legendScrollable ? nextIndex : null);
  }, [autoplayEnabled, autoplayPaused, cycleIndex, legendScrollable, slices.length]);

  useEffect(() => {
    if (!autoplayEnabled || autoplayPaused) return undefined;

    const timer = window.setInterval(() => {
      setCycleIndex((index) => (index + 1) % slices.length);
    }, ALLOCATION_AUTOPLAY_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [autoplayEnabled, autoplayPaused, slices.length]);

  useEffect(() => {
    if (autoplayEnabled) return;

    setActiveIndex(null);
    setLegendStartIndex(null);
  }, [autoplayEnabled]);

  return (
    <section className="panel p-3.5 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex min-h-[24px] min-w-0 items-center gap-2">
          <span className="h-3.5 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
          <span className="label shrink-0">持仓占比</span>
        </div>
        {slices.length > 0 && <span className="chip tnum ml-auto w-fit">{slices.length} 项持仓</span>}
      </div>

      {slices.length === 0 ? (
        <div className="flex min-h-[220px] items-center justify-center text-sm text-[var(--text-faint)]">
          暂无可展示的持仓市值
        </div>
      ) : (
        <div className="chart-reveal grid gap-4 lg:grid-cols-[minmax(260px,0.86fr)_minmax(0,1.14fr)] lg:items-center">
          <div className="relative h-[244px] min-w-0 sm:h-[268px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="value"
                  nameKey="symbol"
                  startAngle={90}
                  endAngle={-270}
                  innerRadius="62%"
                  outerRadius="82%"
                  paddingAngle={1}
                  cornerRadius={3}
                  stroke="var(--surface)"
                  strokeWidth={3}
                  activeIndex={activeIndex ?? undefined}
                  activeShape={prefersReducedMotion ? undefined : renderActiveShape}
                  onMouseEnter={(_, index) => {
                    pauseAutoplay();
                    activateSlice(index, true);
                  }}
                  onMouseLeave={clearChartHover}
                  isAnimationActive={!prefersReducedMotion}
                  animationDuration={220}
                >
                  {slices.map((slice, index) => (
                    <Cell
                      key={slice.id}
                      fill={slice.color}
                      onMouseEnter={() => {
                        pauseAutoplay();
                        activateSlice(index, true);
                      }}
                      onMouseLeave={clearChartHover}
                    />
                  ))}
                </Pie>
                <Tooltip content={<AllocationTooltip currency={currency} />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
              <div className="max-w-[136px] px-2">
                <div className="label">总市值</div>
                <div className="tnum mt-1 truncate text-base font-semibold text-[var(--text)] sm:text-lg">{fmtMoney(total, currency)}</div>
                {activeSlice && (
                  <div className="tnum mt-1 truncate text-[11px] text-[var(--text-faint)]">
                    {activeSlice.symbol} · {fmtPercent(activeSlice.percent * 100)}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="min-w-0">
            <div className={`space-y-2 pr-1 ${legendScrollable ? "max-h-[284px] overflow-y-auto" : ""}`}>
              {legendSlices.map((slice) => (
                <div
                  key={slice.id}
                  onMouseEnter={() => {
                    pauseAutoplay();
                    activateSlice(slices.findIndex((item) => item.id === slice.id), false);
                  }}
                  onMouseLeave={resumeAutoplay}
                  className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border px-3 py-2 transition-all duration-150 ${
                    activeSlice?.id === slice.id
                      ? "border-[var(--accent-line)] bg-[var(--accent-soft)] shadow-[0_10px_26px_-24px_var(--shadow-panel)]"
                      : "border-[var(--border)] bg-[var(--surface-subtle)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
                  }`}
                >
                  <span className="h-6 w-1 rounded-full" style={{ background: slice.color }} />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-[var(--text)] sm:text-sm">{slice.name}</div>
                    <div className="tnum truncate text-xs text-[var(--text-faint)]">{slice.symbol} · {slice.market}</div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--surface-hover)]">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.max(2, slice.percent * 100)}%`, background: slice.color }}
                      />
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="tnum text-sm font-semibold text-[var(--text)]">{fmtPercent(slice.percent * 100)}</div>
                    <div className="tnum mt-0.5 text-xs text-[var(--text-dim)]">{fmtMoney(slice.value, currency)}</div>
                  </div>
                </div>
              ))}
            </div>
            {legendScrollable && (
              <div className="px-3 pt-2 text-xs text-[var(--text-faint)]">滚动查看全部 {slices.length} 项持仓</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
