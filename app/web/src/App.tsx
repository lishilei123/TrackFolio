import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { AdminSettingsPage } from "./components/AdminSettingsPage";
import { GlassLoader } from "./components/GlassLoader";
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
const Charts = lazy(() => import("./components/Charts").then((module) => ({ default: module.Charts })));

function sameMeta(a: Meta | null, b: Meta): boolean {
  return a != null && JSON.stringify(a) === JSON.stringify(b);
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
  const { data, refreshState, lastUpdated, error, manualRefresh, forceRefresh } = usePortfolio(
    currency,
    intervalSec,
  );

  const onCurrencyChange = (c: Currency) => {
    // 首页切换只影响当前看板视图；默认结算货币在后台保存。
    setCurrency(c);
  };

  const holdings = data?.holdings ?? [];
  const hasHoldings = holdings.length > 0;
  const isAdmin = renderedRoute === "#/admin";
  const wasAdminRef = useRef(isAdmin);
  const initialPortfolioLoading = !isAdmin && data == null && refreshState === "loading";
  const settlementTimezone = display?.settlement_timezone ?? "Asia/Shanghai";

  useEffect(() => {
    const wasAdmin = wasAdminRef.current;
    wasAdminRef.current = isAdmin;
    if (wasAdmin && !isAdmin) void forceRefresh();
  }, [forceRefresh, isAdmin]);

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
            onPortfolioChanged={() => void manualRefresh()}
            onLocked={() => {}}
          />
        </div>
      ) : (
        <main key="home" className="app-main page-view mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-3 py-3 sm:px-5 sm:py-5" data-leaving={routeLeaving || undefined}>
          {initialPortfolioLoading ? (
            <GlassLoader heightClass="min-h-[420px] sm:min-h-[500px]" />
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
                  <Suspense fallback={<GlassLoader heightClass="h-[230px] sm:h-[260px]" density="compact" />}>
                    <HistoryChart
                      currency={currency}
                      holdings={holdings}
                      selectedDate={selectedDay?.date ?? null}
                      onSelectDay={(date, granularity) => {
                        setSelectedDay(granularity === "day" && date === settlementToday(settlementTimezone)
                          ? null
                          : { date, granularity });
                      }}
                    />
                  </Suspense>
                  <Suspense fallback={<GlassLoader heightClass="h-[210px] sm:h-[220px]" density="compact" />}>
                    <Charts
                      holdings={holdings}
                      currency={currency}
                      settlementTimezone={settlementTimezone}
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="h-3.5 w-1 rounded-full bg-[var(--accent)]" />
      <span className="label">{children}</span>
      <span className="h-px flex-1 bg-gradient-to-r from-[var(--border)] to-transparent" />
    </div>
  );
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
