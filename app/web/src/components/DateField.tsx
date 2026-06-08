import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isMarketHoliday } from "../lib/tradingCalendar";
import type { Market } from "../types";

interface Props {
  value: string; // yyyy-mm-dd | ""
  onChange: (v: string) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  /** 仅交易日可选：周末休市与未来（未开盘）日期不可选，用于成交日录入 */
  tradingDaysOnly?: boolean;
  /** 标的所属市场，用于按该市场的节假日历屏蔽休市日；缺省时仅按周末+未来屏蔽 */
  market?: Market;
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function fmt(y: number, m: number, d: number): string {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}
function parse(v: string): { y: number; m: number; d: number } | null {
  const x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return x ? { y: +x[1], m: +x[2] - 1, d: +x[3] } : null;
}

/** 主题化日期选择器：触发器沿用 input 样式，弹出日历用 portal 渲染以避免被滚动容器裁切。 */
export function DateField({ value, onChange, className, disabled, placeholder, tradingDaysOnly, market }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; flip: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const today = new Date();
  const sel = parse(value);
  const [view, setView] = useState(() =>
    sel ? { y: sel.y, m: sel.m } : { y: today.getFullYear(), m: today.getMonth() },
  );

  // 每次打开都把视图对齐到当前选中月（或今天）
  useEffect(() => {
    if (!open) return;
    const s = parse(value);
    const now = new Date();
    setView(s ? { y: s.y, m: s.m } : { y: now.getFullYear(), m: now.getMonth() });
  }, [open, value]);

  // 定位：固定定位贴在触发器下方，空间不足则上翻；随滚动/缩放重新计算
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const t = triggerRef.current;
      if (!t) return;
      const r = t.getBoundingClientRect();
      const PH = 312;
      const PW = 248;
      const flip = r.bottom + PH + 6 > window.innerHeight && r.top - PH - 6 > 0;
      const top = flip ? r.top - PH - 6 : r.bottom + 6;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - 8 - PW));
      setPos({ top, left, flip });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  // 点击外部 / Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const startWeekday = (new Date(view.y, view.m, 1).getDay() + 6) % 7; // 周一为 0
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const isToday = (d: number) =>
    today.getFullYear() === view.y && today.getMonth() === view.m && today.getDate() === d;
  const isSel = (d: number) => sel != null && sel.y === view.y && sel.m === view.m && sel.d === d;

  // 未开盘不可选：周末休市 + 该市场法定节假日休市 + 未来日期（尚未开盘成交）
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const isDisabledDay = (d: number): boolean => {
    if (!tradingDaysOnly) return false;
    const dt = new Date(view.y, view.m, d);
    const wd = dt.getDay();
    if (wd === 0 || wd === 6) return true; // 周六/周日休市
    if (dt.getTime() > todayMid) return true; // 未来日期未开盘
    return market != null && isMarketHoliday(market, fmt(view.y, view.m, d)); // 该市场节假日休市
  };
  const todayStr = fmt(today.getFullYear(), today.getMonth(), today.getDate());
  const todayDisabled =
    tradingDaysOnly &&
    (today.getDay() === 0 ||
      today.getDay() === 6 ||
      (market != null && isMarketHoliday(market, todayStr)));

  const pick = (d: number) => {
    if (isDisabledDay(d)) return;
    onChange(fmt(view.y, view.m, d));
    setOpen(false);
  };
  const stepMonth = (delta: number) =>
    setView((v) => {
      const total = v.y * 12 + v.m + delta;
      return { y: Math.floor(total / 12), m: ((total % 12) + 12) % 12 };
    });

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={`${className ?? ""} flex min-w-0 items-center justify-between gap-2 whitespace-nowrap text-left ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
      >
        <span className={`min-w-0 truncate ${value ? "" : "opacity-50"}`}>{value || placeholder || "选择日期"}</span>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" className="shrink-0 opacity-60">
          <rect x="3" y="4.5" width="18" height="16" rx="2" />
          <path d="M3 9h18M8 2.5v4M16 2.5v4" strokeLinecap="round" />
        </svg>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            className="datefield-pop popover-motion"
            style={{ position: "fixed", top: pos.top, left: pos.left, width: 248, zIndex: 100 }}
          >
            <div className="mb-1.5 flex items-center justify-between">
              <button type="button" onClick={() => stepMonth(-1)} className="datefield-nav">
                ‹
              </button>
              <span className="text-sm font-medium" style={{ color: "var(--text)" }}>
                {view.y} 年 {view.m + 1} 月
              </span>
              <button type="button" onClick={() => stepMonth(1)} className="datefield-nav">
                ›
              </button>
            </div>

            <div className="grid grid-cols-7 gap-0.5 text-center text-[11px]" style={{ color: "var(--text-faint)" }}>
              {WEEKDAYS.map((w) => (
                <div key={w} className="py-1">
                  {w}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5">
              {cells.map((d, i) =>
                d == null ? (
                  <div key={i} />
                ) : (
                  <button
                    key={i}
                    type="button"
                    disabled={isDisabledDay(d)}
                    onClick={() => pick(d)}
                    className="datefield-day"
                    data-sel={isSel(d) || undefined}
                    data-today={isToday(d) || undefined}
                    data-disabled={isDisabledDay(d) || undefined}
                  >
                    {d}
                  </button>
                ),
              )}
            </div>

            <div className="mt-2 flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="datefield-link"
              >
                清除
              </button>
              <button
                type="button"
                onClick={() => {
                  const n = new Date();
                  // 今天休市：仅把视图跳到今天所在月，不触发选择
                  if (todayDisabled) {
                    setView({ y: n.getFullYear(), m: n.getMonth() });
                    return;
                  }
                  onChange(fmt(n.getFullYear(), n.getMonth(), n.getDate()));
                  setOpen(false);
                }}
                className="datefield-link"
              >
                今天
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
