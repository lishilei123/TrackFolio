import type { Asset, AssetType, Currency, Market, MarketStatus } from "../domain/types.js";
import { marketStatusFor } from "../domain/marketHours.js";
import type { SecurityRef } from "./catalog.js";
import type { HistoryPoint, NavData, ProviderResult, QuoteData, QuoteProvider } from "./types.js";
export { marketStatusFor } from "../domain/marketHours.js";

/**
 * 真实免费行情 Provider —— 全程零新增依赖（GBK 用内置 TextDecoder，HTTP 用全局 fetch）：
 * - 搜索：新浪 suggest（接受 UTF-8 查询，覆盖 A股/美股/港股/基金）
 * - 实时行情：新浪 hq.sinajs.cn（A股/美股/港股）
 * - 场外基金净值：天天基金 fundgz.1234567.com.cn（估值）
 * - 历史 K 线：腾讯 web.ifzq.gtimg.cn（股票/ETF）、天天基金 lsjz（场外）
 * 所有外部失败均返回 ok:false，由业务层降级（标 unavailable / 跳过回填）。
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** 拉取文本，可选 GBK 解码与 Referer。失败/超时抛错由调用方捕获。 */
async function httpGet(
  url: string,
  opts: { gbk?: boolean; referer?: string; timeoutMs?: number } = {},
): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      ...(opts.referer ? { Referer: opts.referer } : {}),
    },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = await res.arrayBuffer();
  return new TextDecoder(opts.gbk ? "gbk" : "utf-8").decode(buf);
}

/** 解析数字；非有限值返回 null */
function num(x: string | undefined): number | null {
  if (x == null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function round(n: number, d = 4): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function addDays(date: string, n: number): string {
  const t = Date.parse(date + "T00:00:00.000Z");
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10);
}

function hasUsableRecentHistory(points: HistoryPoint[], days: number): boolean {
  if (points.length === 0) return false;
  const newest = points[points.length - 1].date;
  const recentFloor = addDays(newest, -Math.max(days * 3, 30));
  const recent = points.filter((p) => p.date >= recentFloor);
  if (recent.length < 2) return false;
  for (let i = 1; i < recent.length; i++) {
    if (Date.parse(recent[i].date + "T00:00:00.000Z") - Date.parse(recent[i - 1].date + "T00:00:00.000Z") > 7 * 86_400_000) {
      return false;
    }
  }
  return true;
}

const US_MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

function parseSinaUsTime(value: string | undefined, yearValue: string | undefined): string | null {
  const m = value?.match(/^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2})(AM|PM)\s+(EST|EDT)$/);
  const year = Number(yearValue);
  if (!m || !Number.isInteger(year)) return null;
  const month = US_MONTHS[m[1]];
  if (month == null) return null;
  let hour = Number(m[3]);
  if (m[5] === "PM" && hour !== 12) hour += 12;
  if (m[5] === "AM" && hour === 12) hour = 0;
  const utcOffset = m[6] === "EDT" ? 4 : 5;
  return new Date(Date.UTC(year, month, Number(m[2]), hour + utcOffset, Number(m[4]))).toISOString();
}

const REF_SINA = "https://finance.sina.com.cn";
const REF_FUND = "https://fund.eastmoney.com";

// —— 新浪 suggest 类型码 → 领域类型 ——
const CNY: Currency = "CNY";
const USD: Currency = "USD";
const HKD: Currency = "HKD";

/** CN 标的代码是否为场内基金/ETF（区别于普通 A 股） */
function isCnFund(symbol: string): boolean {
  return /^5/.test(symbol) || /^1[5-8]/.test(symbol);
}

/** 把一条 suggest 记录映射为 SecurityRef；不支持的类型返回 null */
function mapSuggest(type: string, code: string, name: string): SecurityRef | null {
  if (type === "11") {
    if (isCnFund(code)) {
      return { asset_type: "FUND", market: "CN", symbol: code, name, currency: CNY, fund_type: "etf" };
    }
    return { asset_type: "STOCK", market: "CN", symbol: code, name, currency: CNY, fund_type: null };
  }
  if (type === "31") {
    return { asset_type: "STOCK", market: "HK", symbol: code.padStart(5, "0"), name, currency: HKD, fund_type: null };
  }
  if (type === "41") {
    return { asset_type: "STOCK", market: "US", symbol: code.toUpperCase(), name, currency: USD, fund_type: null };
  }
  // 21..26：场外基金
  if (/^2[1-6]$/.test(type)) {
    return { asset_type: "FUND", market: "CN", symbol: code, name, currency: CNY, fund_type: "otc" };
  }
  return null; // 指数(33)/期货/外汇/债券等暂不支持
}

/** 由市场 + symbol 构造新浪行情代码 */
function sinaCode(asset: Asset): string {
  if (asset.market === "US") return "gb_" + asset.symbol.toLowerCase();
  if (asset.market === "HK") return "rt_hk" + asset.symbol.padStart(5, "0");
  // CN：首位 5/6/9 → 沪市，否则深市
  return (/^[569]/.test(asset.symbol) ? "sh" : "sz") + asset.symbol;
}

/** 由市场 + symbol 构造腾讯 K 线代码（美股带交易所后缀，best-effort 多试） */
function tencentCodes(asset: Asset): string[] {
  if (asset.market === "HK") return ["hk" + asset.symbol.padStart(5, "0")];
  if (asset.market === "US") {
    const s = asset.symbol.toUpperCase();
    return ["us" + s + ".OQ", "us" + s + ".N", "us" + s];
  }
  return [(/^[569]/.test(asset.symbol) ? "sh" : "sz") + asset.symbol];
}

export class SinaProvider implements QuoteProvider {
  readonly name = "sina";

  /** 前一交易日的前一收盘价缓存（按本地日期，一天只变一次，避免每次刷新都拉 K 线） */
  private prePrevCache = new Map<string, { day: string; value: number | null }>();

  /** 本地日期 YYYY-MM-DD，仅用于缓存键（一天只变一次） */
  private localDay(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  /**
   * 取「前一交易日的前一收盘价」用于昨日盈亏。新浪实时行情不含该字段 → 用腾讯 K 线补。
   * 做法：在日 K 线中找到收盘价 ≈ previousClose 的那一天，取它前一天的收盘价
   *（按值对齐而非按索引，避免美股时区/盘中半截 K 线造成的错位）。按天缓存；失败返回 null。
   */
  private async prePreviousClose(asset: Asset, previousClose: number): Promise<number | null> {
    const day = this.localDay();
    const hit = this.prePrevCache.get(asset.id);
    if (hit && hit.day === day) return hit.value;

    let value: number | null = null;
    const res = await this.fetchHistory(asset, 8); // 8 自然日 ≈ 5~6 交易日
    if (res.ok && res.data.length >= 2) {
      // 从后往前找与 previousClose 最接近的 K 线日（recent 日 qfq 因子≈1，通常精确匹配）
      let bestIdx = -1;
      let bestDiff = Infinity;
      for (let i = res.data.length - 1; i >= 1; i--) {
        const diff = Math.abs(res.data[i].close - previousClose);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = i;
        }
      }
      // 护栏：找不到接近昨收(±2%)的 K 线日，说明实时与 K 线量级不一致（数据异常）→ 宁可不算
      if (bestIdx >= 1 && bestDiff <= previousClose * 0.02) value = res.data[bestIdx - 1].close;
    }
    this.prePrevCache.set(asset.id, { day, value });
    return value;
  }

  async search(
    query: string,
    opts: { market?: Market; asset_type?: AssetType; limit?: number } = {},
  ): Promise<SecurityRef[]> {
    const q = query.trim();
    if (!q) return [];
    const limit = opts.limit ?? 20;
    let text: string;
    try {
      text = await httpGet(
        "https://suggest3.sinajs.cn/suggest/type=&key=" + encodeURIComponent(q),
        { gbk: true, referer: REF_SINA },
      );
    } catch {
      return [];
    }

    const m = text.match(/"([^"]*)"/);
    if (!m || !m[1]) return [];
    const out: SecurityRef[] = [];
    for (const entry of m[1].split(";")) {
      if (!entry) continue;
      const f = entry.split(",");
      const code = f[2];
      const name = f[4] || f[6] || f[0];
      if (!code || !name) continue;
      const ref = mapSuggest(f[1], code, name);
      if (!ref) continue;
      if (opts.market && ref.market !== opts.market) continue;
      if (opts.asset_type && ref.asset_type !== opts.asset_type) continue;
      out.push(ref);
      if (out.length >= limit) break;
    }
    return out;
  }

  async fetchQuote(asset: Asset): Promise<ProviderResult<QuoteData>> {
    try {
      const code = sinaCode(asset);
      const text = await httpGet("https://hq.sinajs.cn/list=" + code, { gbk: true, referer: REF_SINA });
      const m = text.match(/="([^"]*)"/);
      if (!m) return { ok: false, reason: "unavailable" };
      const f = m[1].split(",");
      if (f.length < 4) return { ok: false, reason: "unavailable" };

      let latest: number | null, prevClose: number | null;
      let open: number | null, high: number | null, low: number | null, volume: number | null;
      let changeAmount: number | null, changePercent: number | null;

      let quoteTime: string | null = null;
      if (asset.market === "US") {
        latest = num(f[1]);
        changePercent = num(f[2]);
        changeAmount = num(f[4]);
        open = num(f[5]);
        high = num(f[6]);
        low = num(f[7]);
        volume = num(f[10]);
        prevClose = num(f[26]) ?? (latest != null && changeAmount != null ? round(latest - changeAmount, 4) : null);
        quoteTime = parseSinaUsTime(f[25], f[29]);
      } else if (asset.market === "HK") {
        open = num(f[2]);
        prevClose = num(f[3]);
        high = num(f[4]);
        low = num(f[5]);
        latest = num(f[6]);
        changeAmount = num(f[7]);
        changePercent = num(f[8]);
        volume = num(f[12]); // f[12]=成交量(股)，f[11]=成交额
        if (f[17] && f[18]) quoteTime = new Date(`${f[17].replaceAll("/", "-")}T${f[18]}+08:00`).toISOString();
      } else {
        // CN
        open = num(f[1]);
        prevClose = num(f[2]);
        latest = num(f[3]);
        high = num(f[4]);
        low = num(f[5]);
        volume = num(f[8]);
        changeAmount = null;
        changePercent = null;
        if (f[30] && f[31]) quoteTime = new Date(`${f[30]}T${f[31]}+08:00`).toISOString();
      }

      if (latest == null || latest <= 0 || prevClose == null || prevClose <= 0) {
        return { ok: false, reason: "unavailable" };
      }
      if (changeAmount == null) changeAmount = round(latest - prevClose, 4);
      if (changePercent == null) changePercent = round((changeAmount / prevClose) * 100, 2);

      // 昨日盈亏需要「前一交易日的前一收盘价」，新浪实时不含 → 用 K 线补（按天缓存）
      const prePrevClose = await this.prePreviousClose(asset, prevClose).catch(() => null);

      return {
        ok: true,
        data: {
          latest_price: latest,
          previous_close: prevClose,
          pre_previous_close: prePrevClose,
          open: open ?? latest,
          high: high ?? latest,
          low: low ?? latest,
          volume: volume ?? 0,
          change_amount: changeAmount,
          change_percent: changePercent,
          market_status: marketStatusFor(asset.market),
          quote_time: quoteTime ?? new Date().toISOString(),
        },
      };
    } catch {
      return { ok: false, reason: "unavailable" };
    }
  }

  async fetchNav(asset: Asset): Promise<ProviderResult<NavData>> {
    try {
      const text = await httpGet("https://fundgz.1234567.com.cn/js/" + asset.symbol + ".js", {
        referer: REF_FUND,
      });
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) return { ok: false, reason: "unavailable" };
      const j = JSON.parse(m[0]) as {
        dwjz?: string;
        gsz?: string;
        gszzl?: string;
        jzrq?: string;
      };
      const prevNav = num(j.dwjz);
      if (prevNav == null) return { ok: false, reason: "unavailable" };
      const est = num(j.gsz);
      const latest = est ?? prevNav;
      const changePercent = num(j.gszzl) ?? round(((latest - prevNav) / prevNav) * 100, 2);
      return {
        ok: true,
        data: {
          latest_nav: latest,
          cumulative_nav: prevNav, // 接口不含累计净值，用单位净值近似
          previous_nav: prevNav,
          nav_date: j.jzrq ?? new Date().toISOString().slice(0, 10),
          change_percent: changePercent,
          fund_type: asset.fund_type ?? "otc",
          is_estimated: est != null,
        },
      };
    } catch {
      return { ok: false, reason: "unavailable" };
    }
  }

  async fetchHistory(asset: Asset, days: number): Promise<ProviderResult<HistoryPoint[]>> {
    // 场外基金：天天基金历史净值
    if (asset.asset_type === "FUND" && asset.fund_type === "otc") {
      return this.fetchFundHistory(asset, days);
    }
    // 股票 / 场内 ETF：腾讯 K 线。美股有多个交易所后缀候选，取返回点数最多的一个
    try {
      let best: HistoryPoint[] = [];
      for (const code of tencentCodes(asset)) {
        const url =
          "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=" +
          encodeURIComponent(`${code},day,,,${days},qfq`);
        const text = await httpGet(url);
        const j = JSON.parse(text) as { data?: Record<string, Record<string, unknown>> };
        const node = j.data?.[code];
        if (!node) continue;
        const rows = (node.qfqday ?? node.day) as string[][] | undefined;
        if (!rows || rows.length === 0) continue;
        const points: HistoryPoint[] = [];
        for (const r of rows) {
          const close = num(r[2]);
          if (r[0] && close != null) points.push({ date: r[0], close });
        }
        if (hasUsableRecentHistory(points, days) && points.length > best.length) best = points;
      }
      return best.length > 0 ? { ok: true, data: best } : { ok: false, reason: "unavailable" };
    } catch {
      return { ok: false, reason: "unavailable" };
    }
  }

  private async fetchFundHistory(asset: Asset, days: number): Promise<ProviderResult<HistoryPoint[]>> {
    // 天天基金 lsjz：必须用 startDate/endDate 框定区间，且 pageSize 有上限（>~200 直接返回空）。
    // 否则 pageIndex=1 只返回最近若干条，早于该窗口的日期全部取不到 → 回填会被填成同一个值。
    try {
      const endDate = new Date().toISOString().slice(0, 10);
      const startDate = addDays(endDate, -Math.max(1, days));
      const pageSize = 200;
      const points: HistoryPoint[] = [];

      for (let pageIndex = 1; pageIndex <= 40; pageIndex++) {
        const url =
          "https://api.fund.eastmoney.com/f10/lsjz?fundCode=" +
          asset.symbol +
          `&pageIndex=${pageIndex}&pageSize=${pageSize}&startDate=${startDate}&endDate=${endDate}`;
        const text = await httpGet(url, { referer: REF_FUND });
        const j = JSON.parse(text) as {
          Data?: { LSJZList?: Array<{ FSRQ?: string; DWJZ?: string }> };
          TotalCount?: number;
        };
        const list = j.Data?.LSJZList ?? [];
        for (const it of list) {
          const close = num(it.DWJZ);
          if (it.FSRQ && close != null) points.push({ date: it.FSRQ, close });
        }
        const total = j.TotalCount ?? 0;
        if (list.length === 0 || pageIndex * pageSize >= total) break;
      }

      if (points.length === 0) return { ok: false, reason: "unavailable" };
      points.sort((a, b) => a.date.localeCompare(b.date)); // 升序
      return { ok: true, data: points };
    } catch {
      return { ok: false, reason: "unavailable" };
    }
  }
}
