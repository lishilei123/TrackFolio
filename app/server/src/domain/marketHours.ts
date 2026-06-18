import type { Market, MarketStatus } from "./types.js";
import { isMarketHalfDay, isTradingDay } from "./tradingCalendar.js";

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function marketTimeZone(market: Market): string {
  if (market === "US") return "America/New_York";
  if (market === "HK") return "Asia/Hong_Kong";
  return "Asia/Shanghai";
}

function regularOpenMinute(market: Market): number | null {
  if (market === "CN" || market === "HK" || market === "US") return 9 * 60 + 30;
  return null;
}

function localClock(timeZone: string, value: Date): { date: string; day: number; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(value).map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    day: WEEKDAY_INDEX[parts.weekday] ?? 0,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** 各市场交易状态用于展示和实时行情取价兜底；美股按美东时区，自动处理夏令时。 */
export function marketStatusFor(market: Market, now = new Date()): MarketStatus {
  const { date, minutes } = localClock(marketTimeZone(market), now);
  if (!isTradingDay(market, date)) return "closed";

  if (market === "US") {
    if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return "pre";
    const regularClose = isMarketHalfDay(market, date) ? 13 * 60 : 16 * 60;
    if (minutes >= 9 * 60 + 30 && minutes < regularClose) return "open";
    if (minutes >= regularClose && minutes < 20 * 60) return "post";
    return "closed";
  }

  if (market === "HK") {
    if (minutes >= 9 * 60 && minutes < 9 * 60 + 30) return "pre";
    const halfDay = isMarketHalfDay(market, date);
    if (minutes >= 9 * 60 + 30 && minutes < 12 * 60) return "open";
    if (!halfDay && minutes >= 13 * 60 && minutes < 16 * 60) return "open";
    if (halfDay) return "closed";
    if (minutes >= 16 * 60 && minutes < 16 * 60 + 10) return "post";
    return "closed";
  }

  if (minutes >= 9 * 60 + 15 && minutes < 9 * 60 + 30) return "pre";
  if ((minutes >= 9 * 60 + 30 && minutes < 11 * 60 + 30) || (minutes >= 13 * 60 && minutes < 15 * 60)) {
    return "open";
  }
  if (minutes >= 15 * 60 && minutes < 15 * 60 + 5) return "post";
  return "closed";
}

export function isBeforeRegularOpen(
  market: Market,
  quote: { market_status?: MarketStatus | null; quote_time?: string | null } | null | undefined,
): boolean {
  if (!quote) return false;
  const openMinute = regularOpenMinute(market);
  if (openMinute == null) return false;
  if (quote.market_status === "pre") return true;
  if (quote.market_status !== "closed" || !quote.quote_time) return false;

  const instant = new Date(Date.parse(quote.quote_time));
  if (Number.isNaN(instant.getTime())) return false;
  const { minutes } = localClock(marketTimeZone(market), instant);
  return minutes < openMinute;
}
