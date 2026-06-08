import type { Market } from "./types.js";

export const DEFAULT_SETTLEMENT_TIMEZONE = "Asia/Shanghai";

const MARKET_CLOSE: Record<Market, { timeZone: string; hour: number; minute: number }> = {
  CN: { timeZone: "Asia/Shanghai", hour: 15, minute: 0 },
  HK: { timeZone: "Asia/Hong_Kong", hour: 16, minute: 0 },
  US: { timeZone: "America/New_York", hour: 16, minute: 0 },
};

function parseYmd(value: string): { year: number; month: number; day: number } | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function partsInTimeZone(date: Date, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
}

function offsetMsAt(date: Date, timeZone: string): number {
  const p = partsInTimeZone(date, timeZone);
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - date.getTime();
}

function zonedDateTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = localAsUtc;
  for (let i = 0; i < 4; i++) {
    const next = localAsUtc - offsetMsAt(new Date(utc), timeZone);
    if (Math.abs(next - utc) < 1_000) {
      utc = next;
      break;
    }
    utc = next;
  }
  return new Date(utc);
}

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function dateInTimeZone(value: string | Date, timeZone: string): string | null {
  const date = value instanceof Date ? value : new Date(Date.parse(value));
  if (Number.isNaN(date.getTime())) return null;
  const p = partsInTimeZone(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

export function addDays(date: string, n: number): string {
  const t = Date.parse(date + "T00:00:00.000Z");
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10);
}

export function isWeekend(date: string): boolean {
  const d = new Date(date + "T00:00:00.000Z");
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

export function settlementDateForMarketClose(
  market: Market,
  marketDate: string,
  settlementTimeZone: string,
): string {
  const ymd = parseYmd(marketDate);
  if (!ymd) return marketDate;
  const close = MARKET_CLOSE[market];
  const instant = zonedDateTimeToUtc(close.timeZone, ymd.year, ymd.month, ymd.day, close.hour, close.minute);
  return dateInTimeZone(instant, settlementTimeZone) ?? marketDate;
}

export function marketDateForSettlementDate(
  market: Market,
  settlementDate: string,
  settlementTimeZone: string,
): string | null {
  const candidates = [addDays(settlementDate, -1), settlementDate, addDays(settlementDate, 1)];
  return (
    candidates.find(
      (candidate) =>
        !isWeekend(candidate) &&
        settlementDateForMarketClose(market, candidate, settlementTimeZone) === settlementDate,
    ) ?? null
  );
}
