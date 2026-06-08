import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Currency, PortfolioResponse } from "../types";

export type RefreshState = "idle" | "loading" | "success" | "error";

interface UsePortfolio {
  data: PortfolioResponse | null;
  refreshState: RefreshState;
  lastUpdated: string | null;
  error: string | null;
  /** 手动刷新看板数据 */
  manualRefresh: () => Promise<void>;
  /** 仅重新拉组合（用于切换币种） */
  reload: () => Promise<void>;
  /** 清空已加载的敏感看板数据 */
  clearData: () => void;
}

export function usePortfolio(currency: Currency, intervalSec: number): UsePortfolio {
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [refreshState, setRefreshState] = useState<RefreshState>("loading");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currencyRef = useRef(currency);
  currencyRef.current = currency;

  const clearData = useCallback(() => {
    setData(null);
    setLastUpdated(null);
  }, []);

  const reload = useCallback(async () => {
    try {
      const res = await api.portfolio(currencyRef.current);
      setData(res);
      setError(null);
      setRefreshState("success");
      setLastUpdated(new Date().toISOString());
    } catch (e) {
      clearData();
      setError(e instanceof Error ? e.message : "刷新失败");
      setRefreshState("error");
    }
  }, [clearData]);

  const manualRefresh = useCallback(async () => {
    setRefreshState("loading");
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
      void reload();
    }, intervalSec * 1000);
    return () => clearInterval(timer);
  }, [intervalSec, reload]);

  return { data, refreshState, lastUpdated, error, manualRefresh, reload, clearData };
}
