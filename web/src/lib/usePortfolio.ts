import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Currency, PortfolioResponse } from "../types";

export type RefreshState = "idle" | "loading" | "success" | "error";

interface UsePortfolio {
  data: PortfolioResponse | null;
  refreshState: RefreshState;
  lastUpdated: string | null;
  error: string | null;
  /** 手动刷新：先让后端拉行情，再拉组合 */
  manualRefresh: () => Promise<void>;
  /** 仅重新拉组合（用于切换币种） */
  reload: () => Promise<void>;
}

export function usePortfolio(currency: Currency, intervalSec: number): UsePortfolio {
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [refreshState, setRefreshState] = useState<RefreshState>("loading");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currencyRef = useRef(currency);
  currencyRef.current = currency;

  const reload = useCallback(async () => {
    try {
      const res = await api.portfolio(currencyRef.current);
      setData(res);
      setError(null);
      setRefreshState("success");
      setLastUpdated(new Date().toISOString());
    } catch (e) {
      // 失败时保留已有数据，仅标记异常（需求 5.4 降级）
      setError(e instanceof Error ? e.message : "刷新失败");
      setRefreshState("error");
    }
  }, []);

  const manualRefresh = useCallback(async () => {
    setRefreshState("loading");
    try {
      await api.refresh();
    } catch {
      /* 后端刷新失败也继续尝试拉取最后成功数据 */
    }
    await reload();
  }, [reload]);

  // 切换币种 / 首次加载
  useEffect(() => {
    setRefreshState("loading");
    void reload();
  }, [currency, reload]);

  // 自动刷新
  useEffect(() => {
    if (intervalSec <= 0) return;
    const timer = setInterval(() => {
      void manualRefresh();
    }, intervalSec * 1000);
    return () => clearInterval(timer);
  }, [intervalSec, manualRefresh]);

  return { data, refreshState, lastUpdated, error, manualRefresh, reload };
}
