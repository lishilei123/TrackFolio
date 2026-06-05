import { useEffect, useState } from "react";
import { api } from "./api";
import { AddAssetModal } from "./components/AddAssetModal";
import { AdminSettingsPage } from "./components/AdminSettingsPage";
import { Charts } from "./components/Charts";
import { HistoryChart } from "./components/HistoryChart";
import { HoldingsTable } from "./components/HoldingsTable";
import { OverviewCards } from "./components/OverviewCards";
import { StatusBar } from "./components/StatusBar";
import { usePortfolio } from "./lib/usePortfolio";
import type { Currency, DisplaySetting, Meta } from "./types";

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [display, setDisplay] = useState<DisplaySetting | null>(null);
  const [currency, setCurrency] = useState<Currency>("CNY");
  const [showAdd, setShowAdd] = useState(false);
  const [route, setRoute] = useState(window.location.hash || "#/");

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash || "#/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const theme = display?.theme ?? "dark";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [display?.theme]);

  // 加载元数据与显示设置
  useEffect(() => {
    void (async () => {
      try {
        const [m, d] = await Promise.all([api.meta(), api.getDisplay()]);
        setMeta(m);
        setDisplay(d);
        setCurrency(d.settlement_currency);
      } catch {
        /* 后端未就绪时静默，由 StatusBar 显示状态 */
      }
    })();
  }, []);

  const intervalSec = display?.quote_refresh_interval ?? 30;
  const { data, refreshState, lastUpdated, error, manualRefresh } = usePortfolio(
    currency,
    intervalSec,
  );

  const onCurrencyChange = (c: Currency) => {
    setCurrency(c);
    // 持久化结算货币偏好（需求 5.6 / 5.9）
    api.updateDisplay({ settlement_currency: c }).catch(() => undefined);
  };

  const holdings = data?.holdings ?? [];
  const hasHoldings = holdings.length > 0;
  const isAdmin = route === "#/admin";

  const onDisplayUpdated = (d: DisplaySetting) => {
    setDisplay(d);
    setCurrency(d.settlement_currency);
  };

  return (
    <div className="min-h-full">
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
        }}
      />

      {isAdmin ? (
        <AdminSettingsPage
          meta={meta}
          currencies={meta?.currencies ?? ["CNY", "USD", "HKD"]}
          holdings={holdings}
          settlementCurrency={currency}
          onDisplayUpdated={onDisplayUpdated}
          onPortfolioChanged={() => void manualRefresh()}
        />
      ) : (
        <main className="fade-in mx-auto max-w-[1600px] space-y-5 px-5 py-5">
        {/* 总览指标 */}
        <OverviewCards overview={data?.overview ?? null} currency={currency} />

        {data?.overview && !data.overview.fx_available && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3.5 py-2.5 text-xs text-amber-300">
            <span>⚠</span>
            <span>部分汇率不可用，受影响资产未计入汇总。{data.overview.warnings.join("；")}</span>
          </div>
        )}

        {!hasHoldings ? (
          <EmptyState onAdd={() => setShowAdd(true)} />
        ) : (
          <>
            <SectionLabel>历史盈亏</SectionLabel>
            <HistoryChart currency={currency} />
            <SectionLabel>分析</SectionLabel>
            <Charts holdings={holdings} currency={currency} />
            <SectionLabel>持仓明细</SectionLabel>
            <HoldingsTable
              holdings={holdings}
              currency={currency}
              showOriginal={display?.show_original_currency ?? true}
            />
          </>
        )}

        <footer className="flex items-center justify-center gap-2 pt-3 text-[11px] text-[var(--text-faint)]">
          <span className="chip">行情 {meta?.provider ?? "—"}</span>
          <span className="chip">自动刷新 {intervalSec}s</span>
          <span className="text-[var(--text-faint)]">数据仅供盯盘参考，不构成投资建议</span>
        </footer>
      </main>
      )}

      {showAdd && meta && (
        <AddAssetModal meta={meta} onClose={() => setShowAdd(false)} onCreated={() => void manualRefresh()} />
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
