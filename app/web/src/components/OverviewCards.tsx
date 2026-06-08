import type { Currency, Overview } from "../types";
import { fmtMoney, fmtPercent, fmtSigned, pnlColor } from "../lib/format";

interface Props {
  overview: Overview | null;
  currency: Currency;
}

/** 中性底色 + 涨跌色文字（跟随后台「涨跌配色」设置） */
function pctPill(value: number | null | undefined): string {
  return `bg-white/[0.06] ring-1 ring-white/10 ${pnlColor(value)}`;
}

function Card({
  label,
  value,
  pill,
  sub,
  valueClass,
  highlight,
}: {
  label: string;
  value: string;
  pill?: React.ReactNode;
  sub?: React.ReactNode;
  valueClass?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`panel panel-flat panel-hover relative min-w-0 overflow-hidden px-3.5 py-3 sm:px-4 sm:py-3.5 ${
        highlight ? "ring-1 ring-[var(--accent-line)]" : ""
      }`}
    >
      {highlight && (
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent opacity-70" />
      )}
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        {pill}
      </div>
      <div className={`tnum mt-2 break-words text-[1.35rem] leading-tight font-semibold tracking-tight sm:text-[1.65rem] sm:leading-none ${valueClass ?? "text-slate-50"}`}>
        {value}
      </div>
      {sub != null && <div className="tnum mt-2 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function OverviewCards({ overview, currency }: Props) {
  const ov = overview;
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3 md:grid-cols-4">
      <Card
        label="总资产市值"
        value={fmtMoney(ov?.total_market_value, currency)}
        sub={<>成本 {fmtMoney(ov?.total_cost, currency)}</>}
      />
      <Card
        highlight
        label="今日盈亏"
        value={fmtSigned(ov?.today_pnl, currency)}
        valueClass={pnlColor(ov?.today_pnl)}
        pill={
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${pctPill(ov?.today_pnl_percent)}`}>
            {fmtPercent(ov?.today_pnl_percent)}
          </span>
        }
      />
      <Card
        label="昨日盈亏"
        value={fmtSigned(ov?.yesterday_pnl, currency)}
        valueClass={pnlColor(ov?.yesterday_pnl)}
        pill={
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${pctPill(ov?.yesterday_pnl_percent)}`}>
            {fmtPercent(ov?.yesterday_pnl_percent)}
          </span>
        }
      />
      <Card
        label="总持仓盈亏"
        value={fmtSigned(ov?.total_pnl, currency)}
        valueClass={pnlColor(ov?.total_pnl)}
        pill={
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${pctPill(ov?.total_pnl_percent)}`}>
            {fmtPercent(ov?.total_pnl_percent)}
          </span>
        }
      />
    </div>
  );
}
