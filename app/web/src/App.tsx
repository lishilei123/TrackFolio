import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { AdminSettingsPage } from "./components/AdminSettingsPage";
import { HoldingsTable } from "./components/HoldingsTable";
import { OverviewCards } from "./components/OverviewCards";
import { StatusBar } from "./components/StatusBar";
import { usePortfolio } from "./lib/usePortfolio";
import { syncBrowserIcon } from "./lib/favicon";
import { loadCachedDisplay, loadCachedMeta, saveCachedDisplay, saveCachedMeta } from "./lib/appCache";
import { usePrefersReducedMotion } from "./lib/motion";
import { settlementToday } from "./lib/timezone";
import { CUSTOM_VAR_NAMES, deriveCustomVars } from "./lib/theme";
import type { Currency, DisplaySetting, Granularity, Meta } from "./types";

const HistoryChart = lazy(() =>
  import("./components/HistoryChart").then((module) => ({ default: module.HistoryChart })),
);
const HoldingsAllocationChart = lazy(() =>
  import("./components/HoldingsAllocationChart").then((module) => ({ default: module.HoldingsAllocationChart })),
);
const Charts = lazy(() => import("./components/Charts").then((module) => ({ default: module.Charts })));
const SCROLL_RESTORE_KEY = "trackfolio:scroll-position";
const HISTORY_FALLBACK_RANGES: Array<[string, string]> = [
  ["7d", "近 7 天"],
  ["30d", "近 30 天"],
  ["90d", "近 90 天"],
  ["ytd", "今年"],
];
const CONTRIBUTION_FALLBACK_RANGES: Array<[string, string]> = [
  ["today", "今日"],
  ["7d", "近 7 天"],
  ["30d", "近 30 天"],
  ["90d", "近 90 天"],
  ["ytd", "今年"],
];
const MARKET_FALLBACK_FILTERS: Array<[string, string]> = [
  ["ALL", "全部市场"],
  ["CN", "A股"],
  ["US", "美股"],
  ["HK", "港股"],
];
const HOLDING_TABLE_HEADINGS = [
  "资产",
  "市场",
  "最新价 / 净值",
  "涨跌幅",
  "持仓",
  "成本(含费)",
  "市值",
  "今日盈亏",
  "总盈亏",
  "更新时间",
  "状态",
];

function sameMeta(a: Meta | null, b: Meta): boolean {
  return a != null && JSON.stringify(a) === JSON.stringify(b);
}

function currentRouteKey(): string {
  return window.location.hash || "#/";
}

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [display, setDisplay] = useState<DisplaySetting | null>(null);
  const [currency, setCurrency] = useState<Currency>("CNY");
  const [route, setRoute] = useState(window.location.hash || "#/");
  const [renderedRoute, setRenderedRoute] = useState(route);
  const [routeLeaving, setRouteLeaving] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();
  // 走势图选中的节点日期（联动「盈亏分析」面板）；null 表示默认看今日
  const [selectedDay, setSelectedDay] = useState<{ date: string; granularity: Granularity } | null>(null);

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash || "#/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (route === renderedRoute) return;
    if (prefersReducedMotion) {
      setRenderedRoute(route);
      setRouteLeaving(false);
      return;
    }

    setRouteLeaving(true);
    const timer = window.setTimeout(() => {
      setRenderedRoute(route);
      setRouteLeaving(false);
    }, 140);
    return () => window.clearTimeout(timer);
  }, [prefersReducedMotion, renderedRoute, route]);

  useEffect(() => {
    const setting = display?.theme ?? "dark";
    const root = document.documentElement;
    const clearCustomVars = () => CUSTOM_VAR_NAMES.forEach((name) => root.style.removeProperty(name));

    // 自定义主题：在所选底座上内联覆盖派生变量（内联优先级高于 :root 选择器）
    if (setting === "custom" && display?.custom_theme) {
      const ct = display.custom_theme;
      root.dataset.theme = ct.base;
      root.style.colorScheme = ct.base;
      const vars = deriveCustomVars(ct);
      for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
      return;
    }

    // 其余主题：先清除自定义遗留的内联变量，再应用预设
    clearCustomVars();
    const mql = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      const resolved = setting === "auto" ? (mql.matches ? "light" : "dark") : setting;
      root.dataset.theme = resolved;
      root.style.colorScheme = resolved;
    };
    apply();
    // 自动模式下，跟随系统深浅色实时切换
    if (setting === "auto") {
      mql.addEventListener("change", apply);
      return () => mql.removeEventListener("change", apply);
    }
  }, [display?.theme, display?.custom_theme]);

  useEffect(() => {
    return syncBrowserIcon(display);
  }, [display?.theme, display?.custom_theme]);

  // 涨跌配色方案：预设通过 data-pnl 切换；自定义通过内联 token 覆盖。
  useEffect(() => {
    const root = document.documentElement;
    const scheme = display?.pnl_color_scheme ?? "green_up";
    root.dataset.pnl = scheme;
    if (scheme === "custom" && display) {
      root.style.setProperty("--pnl-up", display.pnl_up_color);
      root.style.setProperty("--pnl-down", display.pnl_down_color);
      root.style.setProperty("--pnl-flat", display.pnl_flat_color);
      return;
    }
    root.style.removeProperty("--pnl-up");
    root.style.removeProperty("--pnl-down");
    root.style.removeProperty("--pnl-flat");
  }, [display?.pnl_color_scheme, display?.pnl_up_color, display?.pnl_down_color, display?.pnl_flat_color]);

  // 切换结算币种时清空选中日，避免跨币种残留
  useEffect(() => {
    setSelectedDay(null);
  }, [currency]);

  // 加载元数据与显示设置
  useEffect(() => {
    const cachedMeta = loadCachedMeta();
    if (cachedMeta) setMeta(cachedMeta);

    const cachedDisplay = loadCachedDisplay();
    if (cachedDisplay) {
      setDisplay(cachedDisplay);
      setCurrency(cachedDisplay.settlement_currency);
    }

    void (async () => {
      try {
        const [m, d] = await Promise.all([api.meta(), api.getDisplay()]);
        setMeta((current) => (sameMeta(current, m) ? current : m));
        setDisplay((current) => (current?.updated_at === d.updated_at ? current : d));
        setCurrency(d.settlement_currency);
        saveCachedMeta(m);
        saveCachedDisplay(d);
      } catch {
        /* 后端未就绪时静默，由 StatusBar 显示状态 */
      }
    })();
  }, []);

  const intervalSec = display?.quote_refresh_interval ?? 30;
  const { data, refreshState, lastUpdated, chartAnimationVersion, error, manualRefresh } = usePortfolio(
    currency,
    intervalSec,
  );

  const onCurrencyChange = (c: Currency) => {
    // 首页切换只影响当前看板视图；默认结算货币在后台保存。
    setCurrency(c);
  };

  const holdings = data?.holdings ?? [];
  const archivedHoldings = data?.archived ?? [];
  const hasHoldings = holdings.length > 0;
  const isAdmin = renderedRoute === "#/admin";
  const wasAdminRef = useRef(isAdmin);
  const initialPortfolioLoading = !isAdmin && data == null && refreshState === "loading";
  const settlementTimezone = display?.settlement_timezone ?? "Asia/Shanghai";
  useBrowserRefreshScrollRestoration(!initialPortfolioLoading && !routeLeaving);

  useEffect(() => {
    const wasAdmin = wasAdminRef.current;
    wasAdminRef.current = isAdmin;
    if (wasAdmin && !isAdmin) void manualRefresh();
  }, [isAdmin, manualRefresh]);

  const onDisplayUpdated = (d: DisplaySetting) => {
    saveCachedDisplay(d);
    setDisplay(d);
    setCurrency(d.settlement_currency);
  };

  return (
    <div className="app-shell flex min-h-full flex-col">
      {display?.background_image && (
        <>
          <div
            aria-hidden
            className="app-bg-photo"
            style={{
              backgroundImage: `url("${display.background_image}")`,
              filter: display.background_blur ? `blur(${display.background_blur}px)` : undefined,
            }}
          />
          <div
            aria-hidden
            className="app-bg-dim"
            style={{ backgroundColor: `rgba(0, 0, 0, ${display.background_dim})` }}
          />
        </>
      )}
      <StatusBar
        currency={currency}
        currencies={meta?.currencies ?? ["CNY", "USD", "HKD"]}
        onCurrencyChange={onCurrencyChange}
        refreshState={refreshState}
        lastUpdated={lastUpdated}
        error={error}
        holdings={holdings}
        onRefresh={() => void manualRefresh()}
        isAdmin={isAdmin}
        onOpenAdmin={() => {
          window.location.hash = "#/admin";
        }}
        onHome={() => {
          window.location.hash = "#/";
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />

      {isAdmin ? (
        <div key="admin" className="page-view flex-1" data-leaving={routeLeaving || undefined}>
          <AdminSettingsPage
            meta={meta}
            currencies={meta?.currencies ?? ["CNY", "USD", "HKD"]}
            holdings={holdings}
            settlementCurrency={currency}
            onDisplayUpdated={onDisplayUpdated}
            onPortfolioChanged={manualRefresh}
            onLocked={() => {}}
          />
        </div>
      ) : (
        <main key="home" className="app-main page-view mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-3 py-3 sm:px-5 sm:py-5" data-leaving={routeLeaving || undefined}>
          {initialPortfolioLoading ? (
            <HomeLoadingSkeleton />
          ) : (
            <>
              <div className="home-content space-y-4 sm:space-y-5">
              {/* 总览指标 */}
              <OverviewCards overview={data?.overview ?? null} currency={currency} />

              {data?.overview && !data.overview.fx_available && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3.5 py-2.5 text-xs text-amber-300">
                  <span>⚠</span>
                  <span>部分汇率不可用，受影响资产未计入汇总。{data.overview.warnings.join("；")}</span>
                </div>
              )}

              {!hasHoldings ? (
                <EmptyState onAdd={() => { window.location.hash = "#/admin"; }} />
              ) : (
                <>
                  <SectionLabel>历史盈亏</SectionLabel>
                  <Suspense fallback={<HistoryChartFallback />}>
                    <HistoryChart
                      currency={currency}
                      holdings={holdings}
                      refreshVersion={lastUpdated}
                      animationVersion={chartAnimationVersion}
                      selectedDate={selectedDay?.date ?? null}
                      onSelectDay={(date, granularity) => {
                        setSelectedDay(granularity === "day" && date === settlementToday(settlementTimezone)
                          ? null
                          : { date, granularity });
                      }}
                    />
                  </Suspense>
                  <Suspense fallback={<ChartsFallback />}>
                    <Charts
                      holdings={holdings}
                      archivedToday={archivedHoldings}
                      currency={currency}
                      settlementTimezone={settlementTimezone}
                      refreshVersion={lastUpdated}
                      animationVersion={chartAnimationVersion}
                      selectedDay={selectedDay}
                      onClearDay={() => setSelectedDay(null)}
                    />
                  </Suspense>
                  <SectionLabel>持仓明细</SectionLabel>
                  <HoldingsTable
                    holdings={holdings}
                    currency={currency}
                    showOriginal={display?.show_original_currency ?? true}
                  />
                  <Suspense fallback={<AllocationChartFallback />}>
                    <HoldingsAllocationChart holdings={holdings} currency={currency} />
                  </Suspense>
                </>
              )}

              </div>

              <footer className="mobile-safe-footer mt-auto flex flex-wrap items-center justify-center gap-1.5 px-1 pt-5 text-center text-[11px] text-[var(--text-faint)] sm:gap-2 sm:pt-6">
                <span className="chip">行情 {meta?.provider ?? "—"}</span>
                <span className="chip">自动刷新 {intervalSec}s</span>
                <span className="w-full text-[10px] leading-snug text-[var(--text-faint)] sm:w-auto sm:text-[11px]">数据仅供盯盘参考，不构成投资建议</span>
              </footer>
            </>
          )}
      </main>
      )}
    </div>
  );
}

function useBrowserRefreshScrollRestoration(ready: boolean) {
  const pendingRestoreRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";

    try {
      const raw = window.sessionStorage.getItem(SCROLL_RESTORE_KEY);
      window.sessionStorage.removeItem(SCROLL_RESTORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { route?: unknown; x?: unknown; y?: unknown };
        if (
          parsed.route === currentRouteKey() &&
          typeof parsed.x === "number" &&
          typeof parsed.y === "number"
        ) {
          pendingRestoreRef.current = { x: parsed.x, y: parsed.y };
        }
      }
    } catch {
      pendingRestoreRef.current = null;
    }

    const saveScroll = () => {
      try {
        window.sessionStorage.setItem(
          SCROLL_RESTORE_KEY,
          JSON.stringify({ route: currentRouteKey(), x: window.scrollX, y: window.scrollY }),
        );
      } catch {
        /* sessionStorage may be unavailable in private or restricted contexts. */
      }
    };

    window.addEventListener("beforeunload", saveScroll);
    window.addEventListener("pagehide", saveScroll);
    return () => {
      window.removeEventListener("beforeunload", saveScroll);
      window.removeEventListener("pagehide", saveScroll);
      window.history.scrollRestoration = previousRestoration;
    };
  }, []);

  useEffect(() => {
    if (!ready || pendingRestoreRef.current == null) return;
    const target = pendingRestoreRef.current;
    pendingRestoreRef.current = null;
    let frame = 0;
    let nextFrame = 0;
    frame = window.requestAnimationFrame(() => {
      nextFrame = window.requestAnimationFrame(() => {
        const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        window.scrollTo(target.x, Math.min(target.y, maxY));
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(nextFrame);
    };
  }, [ready]);
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="h-3.5 w-1 rounded-full bg-[var(--accent)]" />
      <span className="label">{children}</span>
      <span className="h-px flex-1 bg-gradient-to-r from-[var(--border)] to-transparent" />
    </div>
  );
}

function HomeLoadingSkeleton() {
  return (
    <>
      <div className="home-content space-y-4 sm:space-y-5" aria-busy="true">
        <OverviewCardsSkeleton />
        <SectionLabel>历史盈亏</SectionLabel>
        <HistoryChartFallback />
        <ChartsFallback />
        <SectionLabel>持仓明细</SectionLabel>
        <HoldingsTableFallback />
      </div>

      <footer
        aria-hidden
        className="mobile-safe-footer mt-auto flex flex-wrap items-center justify-center gap-1.5 px-1 pt-5 text-center text-[11px] text-[var(--text-faint)] sm:gap-2 sm:pt-6"
      >
        <SkeletonBlock className="h-[22px] w-20 rounded-full" />
        <SkeletonBlock className="h-[22px] w-24 rounded-full" />
        <SkeletonBlock className="h-[18px] w-64 max-w-full rounded-[4px]" />
      </footer>
    </>
  );
}

function OverviewCardsSkeleton() {
  const labels = ["总资产市值", "今日盈亏", "昨日盈亏", "总持仓盈亏"];

  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3 md:grid-cols-4" aria-hidden>
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className={`panel panel-flat relative min-w-0 overflow-hidden px-3.5 py-3 sm:px-4 sm:py-3.5 ${
            index === 1 ? "ring-1 ring-[var(--accent-line)]" : ""
          }`}
        >
          {index === 1 && (
            <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent opacity-70" />
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="label">{labels[index]}</span>
            {index > 0 && <SkeletonBlock className="h-5 w-14 rounded-full" />}
          </div>
          <SkeletonBlock className="mt-2 h-[1.35rem] w-32 sm:h-[1.65rem]" />
          {index === 0 && (
            <div className="mt-2 flex items-center gap-1 text-xs text-slate-500">
              <span>成本</span>
              <SkeletonBlock className="h-3 w-20" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function HistoryChartFallback() {
  return (
    <div className="panel p-3.5 sm:p-4" aria-hidden>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="h-3.5 w-1 rounded-full bg-[var(--accent)]" />
        <span className="label">盈亏走势</span>
        <span className="flex min-h-[24px] min-w-[46px] items-center">
          <span className="estimate-badge">
            <span className="estimate-badge-dot" />
            估算
          </span>
        </span>
        <div className="flex w-full min-w-0 items-center justify-end gap-2 overflow-x-auto sm:ml-auto sm:w-auto">
          <StaticSegmented options={HISTORY_FALLBACK_RANGES} value="7d" />
        </div>
      </div>
      <ChartAreaSkeleton className="h-[230px] sm:h-[260px]" />
    </div>
  );
}

function ChartsFallback() {
  return (
    <div className="panel p-3.5 sm:p-4" aria-hidden>
      <div className="mb-3 space-y-2 sm:flex sm:items-center sm:gap-2 sm:space-y-0">
        <div className="flex min-h-[24px] min-w-0 items-center gap-2">
          <span className="h-3.5 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
          <span className="label shrink-0">盈亏分析</span>
          <span className="flex min-h-[24px] min-w-[104px] items-center" />
        </div>
        <div className="flex w-full min-w-0 items-center justify-end gap-2 overflow-x-auto sm:ml-auto sm:w-auto">
          <StaticSegmented options={CONTRIBUTION_FALLBACK_RANGES} value="today" />
        </div>
      </div>
      <ChartAreaSkeleton className="h-[210px] sm:h-[220px]" />
    </div>
  );
}

function AllocationChartFallback() {
  return (
    <div className="panel p-4 sm:p-5" aria-hidden>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="label">Allocation</div>
          <SkeletonBlock className="mt-2 h-5 w-24" />
        </div>
        <SkeletonBlock className="mt-2 h-6 w-20 rounded-[4px] sm:mt-0" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.1fr)] lg:items-center">
        <ChartAreaSkeleton className="h-[260px] sm:h-[300px]" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
              <SkeletonBlock className="h-4 w-40 max-w-full" />
              <SkeletonBlock className="mt-2 h-3 w-28 max-w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ChartAreaSkeleton({ className }: { className: string }) {
  return (
    <div
      className={`relative grid place-items-center overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.025] ${className}`}
      aria-hidden
    >
      <div className="relative h-14 w-14 rounded-xl border border-[var(--accent-line)] bg-white/[0.03]">
        <span className="absolute left-3 right-3 top-6 h-0.5 rotate-[-18deg] rounded-full bg-[var(--accent)] opacity-50" />
        <span className="absolute bottom-3 left-3 flex h-6 items-end gap-1">
          <span className="h-2 w-1 rounded-full bg-[var(--accent)] opacity-45" />
          <span className="h-3 w-1 rounded-full bg-[var(--accent)] opacity-60" />
          <span className="h-4 w-1 rounded-full bg-[var(--accent)] opacity-75" />
          <span className="h-5 w-1 rounded-full bg-[var(--accent)] opacity-90" />
        </span>
      </div>
    </div>
  );
}

function HoldingsTableFallback() {
  const columns = ["w-[22%]", "w-[5%]", "w-[8%]", "w-[7%]", "w-[5%]", "w-[9%]", "w-[11%]", "w-[9%]", "w-[9%]", "w-[10%]", "w-[5%]"];

  return (
    <div className="panel overflow-hidden" aria-hidden>
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] p-2.5 sm:p-3">
        <StaticSegmented options={MARKET_FALLBACK_FILTERS} value="ALL" className="w-full sm:w-auto" />
        <div className="flex w-full items-center gap-3 sm:ml-auto sm:w-auto">
          <div className="flex h-8 w-full items-center rounded-[5px] border border-white/[0.08] bg-white/[0.03] px-3 text-xs text-slate-500 sm:w-52">
            搜索代码或名称
          </div>
        </div>
      </div>

      <div className="md:hidden">
        <div className="divide-y divide-white/[0.06]">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="px-3 py-3">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <SkeletonBlock className="h-9 w-11 rounded-[5px]" />
                  <div className="min-w-0">
                    <SkeletonBlock className="h-4 w-36 max-w-[46vw]" />
                    <SkeletonBlock className="mt-2 h-3 w-24 max-w-[38vw]" />
                  </div>
                </div>
                <div className="shrink-0">
                  <SkeletonBlock className="ml-auto h-4 w-16" />
                  <SkeletonBlock className="ml-auto mt-2 h-3 w-12" />
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/[0.04] pt-3">
                {Array.from({ length: 6 }).map((__, metricIndex) => (
                  <div key={metricIndex}>
                    <SkeletonBlock className="h-3 w-14" />
                    <SkeletonBlock className="mt-2 h-4 w-20 max-w-full" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="hidden overflow-hidden md:block">
        <table className="w-full min-w-[1160px] table-fixed text-sm">
          <colgroup>
            {columns.map((column, index) => (
              <col key={index} className={column} />
            ))}
          </colgroup>
          <thead className="bg-[var(--surface-2)]">
            <tr className="h-[37px] border-b border-white/[0.06]">
              {HOLDING_TABLE_HEADINGS.map((heading, index) => (
                <th
                  key={heading}
                  className={`px-3 py-2.5 text-[10px] font-medium uppercase tracking-[0.08em] text-slate-500 ${
                    index === 0 ? "text-left" : index === HOLDING_TABLE_HEADINGS.length - 1 ? "text-center" : "text-right"
                  }`}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, rowIndex) => (
              <tr key={rowIndex} className="h-[58px] border-b border-white/[0.04] last:border-0">
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <SkeletonBlock className="h-9 w-11 rounded-[5px]" />
                    <div className="min-w-0">
                      <SkeletonBlock className="h-4 w-40" />
                      <SkeletonBlock className="mt-2 h-3 w-24" />
                    </div>
                  </div>
                </td>
                {Array.from({ length: 10 }).map((__, cellIndex) => (
                  <td key={cellIndex} className="px-3 py-2.5">
                    <SkeletonBlock className={`${cellIndex === 0 ? "mx-auto w-10" : "ml-auto w-16"} h-4`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-2 border-t border-white/[0.06] px-3 py-2 sm:flex sm:items-center sm:justify-between sm:gap-3 sm:py-2.5">
        <div className="flex items-center justify-between gap-2 sm:justify-start">
          <SkeletonBlock className="h-7 w-36 rounded-[5px]" />
          <SkeletonBlock className="h-4 w-20" />
        </div>
        <div className="flex items-center justify-center gap-2 sm:ml-auto sm:w-auto sm:justify-end sm:gap-1.5">
          <SkeletonBlock className="hidden h-6 w-6 rounded-[5px] sm:block" />
          <SkeletonBlock className="h-7 w-7 rounded-[5px] sm:h-6 sm:w-6" />
          <SkeletonBlock className="h-4 w-10" />
          <SkeletonBlock className="h-7 w-7 rounded-[5px] sm:h-6 sm:w-6" />
          <SkeletonBlock className="hidden h-6 w-6 rounded-[5px] sm:block" />
        </div>
      </div>
    </div>
  );
}

function StaticSegmented({
  options,
  value,
  className = "",
}: {
  options: Array<[string, string]>;
  value: string;
  className?: string;
}) {
  const activeIndex = options.findIndex(([val]) => val === value);

  return (
    <div
      className={`relative grid rounded-[5px] border border-white/[0.08] bg-white/[0.02] p-0.5 ${className}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {activeIndex >= 0 && (
        <span
          aria-hidden
          className="segment-indicator absolute bottom-0.5 left-0.5 top-0.5 rounded-[3px] bg-[var(--accent)]"
          style={{
            width: `calc((100% - 4px) / ${options.length})`,
            transform: `translateX(${activeIndex * 100}%)`,
          }}
        />
      )}
      {options.map(([val, label]) => (
        <span
          key={val}
          className={`relative z-10 whitespace-nowrap rounded-[3px] px-2 py-1 text-center text-xs tracking-wide sm:px-2.5 ${
            value === val ? "font-medium text-[var(--accent-contrast)]" : "text-slate-400"
          }`}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function SkeletonBlock({ className }: { className: string }) {
  return <span className={`block animate-pulse rounded-[4px] bg-white/[0.06] ${className}`} />;
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="panel flex flex-col items-center justify-center py-20 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[var(--accent-soft)] text-2xl ring-1 ring-[var(--accent-line)]">
        📈
      </div>
      <div className="mt-4 text-base font-medium text-[var(--text)]">还没有持仓</div>
      <div className="mt-1 text-sm text-[var(--text-dim)]">添加一只股票或基金，开始盯盘你的盈亏</div>
      <button onClick={onAdd} className="btn-accent mt-5 px-5 py-2 text-sm">
        + 添加第一个资产
      </button>
    </div>
  );
}
