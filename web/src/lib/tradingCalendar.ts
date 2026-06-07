import type { Market } from "../types";

// 各市场节假日休市日历(yyyy-mm-dd,仅收录「工作日」的法定休市日)。
//
// 周末(周六/周日)一律休市,由调用方按 getDay 处理,此处不重复列出;半日交易(如除夕、圣诞前夕)仍属交易日,不计入休市。
// 未收录的「市场 + 年份」将退化为「仅周末休市」——只屏蔽周末与未来日期,不屏蔽未知节假日,以免误拦合法交易日。
//
// 数据来源:
//   CN(沪深) —— 上海证券交易所官方休市安排公告。
//   US(NYSE/Nasdaq) —— NYSE Group 假日日历(联邦假日 + 耶稣受难节;半日提前收市不计休市)。
//   HK(港交所) —— 香港政府公众假期 / HKEX 证券市场休市安排。
// 每年底各交易所发布次年安排后需在此追加。
const HOLIDAYS: Record<Market, Record<number, string[]>> = {
  CN: {
    2023: [
      "2023-01-02", // 元旦
      "2023-01-23", "2023-01-24", "2023-01-25", "2023-01-26", "2023-01-27", // 春节
      "2023-04-05", // 清明
      "2023-05-01", "2023-05-02", "2023-05-03", // 劳动节
      "2023-06-22", "2023-06-23", // 端午
      "2023-09-29", "2023-10-02", "2023-10-03", "2023-10-04", "2023-10-05", "2023-10-06", // 中秋/国庆
    ],
    2024: [
      "2024-01-01", // 元旦
      "2024-02-09", "2024-02-12", "2024-02-13", "2024-02-14", "2024-02-15", "2024-02-16", // 春节
      "2024-04-04", "2024-04-05", // 清明
      "2024-05-01", "2024-05-02", "2024-05-03", // 劳动节
      "2024-06-10", // 端午
      "2024-09-16", "2024-09-17", // 中秋
      "2024-10-01", "2024-10-02", "2024-10-03", "2024-10-04", "2024-10-07", // 国庆
    ],
    2025: [
      "2025-01-01", // 元旦
      "2025-01-28", "2025-01-29", "2025-01-30", "2025-01-31", "2025-02-03", "2025-02-04", // 春节
      "2025-04-04", // 清明
      "2025-05-01", "2025-05-02", "2025-05-05", // 劳动节
      "2025-06-02", // 端午
      "2025-10-01", "2025-10-02", "2025-10-03", "2025-10-06", "2025-10-07", "2025-10-08", // 国庆/中秋
    ],
    2026: [
      "2026-01-01", "2026-01-02", // 元旦
      "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", "2026-02-23", // 春节
      "2026-04-06", // 清明
      "2026-05-01", "2026-05-04", "2026-05-05", // 劳动节
      "2026-06-19", // 端午
      "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07", // 国庆/中秋
    ],
  },
  US: {
    2023: [
      "2023-01-02", // New Year(顺延)
      "2023-01-16", // MLK Day
      "2023-02-20", // Presidents' Day
      "2023-04-07", // Good Friday
      "2023-05-29", // Memorial Day
      "2023-06-19", // Juneteenth
      "2023-07-04", // Independence Day
      "2023-09-04", // Labor Day
      "2023-11-23", // Thanksgiving
      "2023-12-25", // Christmas
    ],
    2024: [
      "2024-01-01", // New Year
      "2024-01-15", // MLK Day
      "2024-02-19", // Presidents' Day
      "2024-03-29", // Good Friday
      "2024-05-27", // Memorial Day
      "2024-06-19", // Juneteenth
      "2024-07-04", // Independence Day
      "2024-09-02", // Labor Day
      "2024-11-28", // Thanksgiving
      "2024-12-25", // Christmas
    ],
    2025: [
      "2025-01-01", // New Year
      "2025-01-20", // MLK Day
      "2025-02-17", // Presidents' Day
      "2025-04-18", // Good Friday
      "2025-05-26", // Memorial Day
      "2025-06-19", // Juneteenth
      "2025-07-04", // Independence Day
      "2025-09-01", // Labor Day
      "2025-11-27", // Thanksgiving
      "2025-12-25", // Christmas
    ],
    2026: [
      "2026-01-01", // New Year
      "2026-01-19", // MLK Day
      "2026-02-16", // Presidents' Day
      "2026-04-03", // Good Friday
      "2026-05-25", // Memorial Day
      "2026-06-19", // Juneteenth
      "2026-07-03", // Independence Day(7/4 周六,顺延前一日)
      "2026-09-07", // Labor Day
      "2026-11-26", // Thanksgiving
      "2026-12-25", // Christmas
    ],
  },
  HK: {
    // 港股 2023/2024 历史休市数据暂缺,退化为仅周末休市。
    2025: [
      "2025-01-01", // 元旦
      "2025-01-29", "2025-01-30", "2025-01-31", // 农历新年(除夕 1/28 半日交易)
      "2025-04-04", // 清明节
      "2025-04-18", "2025-04-21", // 耶稣受难节 / 复活节后星期一
      "2025-05-01", // 劳动节
      "2025-05-05", // 佛诞
      "2025-06-02", // 端午节
      "2025-07-01", // 香港特别行政区成立纪念日
      "2025-10-01", // 国庆节
      "2025-10-07", // 中秋节翌日
      "2025-10-29", // 重阳节
      "2025-12-25", "2025-12-26", // 圣诞节(平安夜 12/24 半日交易)
    ],
    2026: [
      "2026-01-01", // 元旦
      "2026-02-17", "2026-02-18", "2026-02-19", // 农历新年(除夕 2/16 半日交易)
      "2026-04-03", // 耶稣受难节
      "2026-04-06", "2026-04-07", // 复活节后星期一 / 清明节补假
      "2026-05-01", // 劳动节
      "2026-05-25", // 佛诞补假(佛诞 5/24 周日)
      "2026-06-19", // 端午节
      "2026-07-01", // 香港特别行政区成立纪念日
      "2026-09-28", // 中秋节翌日补假
      "2026-10-01", // 国庆节
      "2026-10-19", // 重阳节补假(重阳 10/18 周日)
      "2026-12-25", // 圣诞节(12/26 为周六)
    ],
  },
};

const SETS: Record<Market, Set<string>> = {
  CN: new Set(Object.values(HOLIDAYS.CN).flat()),
  US: new Set(Object.values(HOLIDAYS.US).flat()),
  HK: new Set(Object.values(HOLIDAYS.HK).flat()),
};

/** 指定市场下,该日期(yyyy-mm-dd)是否为已收录的法定休市日(不含周末)。 */
export function isMarketHoliday(market: Market, date: string): boolean {
  return SETS[market].has(date);
}

function parseYmd(date: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/** 指定市场下,该日期是否为交易日(非周末且非法定休市日)。 */
export function isTradingDay(market: Market, date: string): boolean {
  const d = parseYmd(date);
  if (!d) return false;
  const wd = d.getDay();
  if (wd === 0 || wd === 6) return false;
  return !isMarketHoliday(market, date);
}

/** 返回该日期之后(不含当天)的下一个交易日。 */
export function nextTradingDay(market: Market, date: string): string {
  const d = parseYmd(date);
  if (!d) return date;
  do {
    d.setDate(d.getDate() + 1);
  } while (!isTradingDay(market, ymd(d)));
  return ymd(d);
}

/**
 * 返回该日期之后第 n 个交易日(n>=1);
 * n=0 时:date 本身是交易日则返回当天,否则顺延到下一个交易日。
 * 用于按「申购日 + N 个交易日」推算基金份额确认日。
 */
export function addTradingDays(market: Market, date: string, n: number): string {
  if (n <= 0) return isTradingDay(market, date) ? date : nextTradingDay(market, date);
  let cur = date;
  for (let i = 0; i < n; i++) cur = nextTradingDay(market, cur);
  return cur;
}
