import { useCallback, useEffect, useRef, useState } from "react";

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => (
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false
  ));

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);

    setReduced(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

/**
 * 当 key 变化时返回一个递增计数，挂在图表容器的 React key 上以触发重新挂载、重放入场动画。
 * 更新放在下一帧执行，确保浏览器整页刷新后的首次有效图表也会重放 Recharts 动画。
 */
export function useReplayKey(key: string): number {
  const [counter, setCounter] = useState(0);
  const prevKey = useRef<string | null>(null);

  useEffect(() => {
    if (prevKey.current === key) return;
    prevKey.current = key;
    const frame = window.requestAnimationFrame(() => {
      setCounter((value) => value + 1);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [key]);

  return counter;
}

export function useExitTransition(onExited: () => void, durationMs = 180) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [isExiting, setIsExiting] = useState(false);
  const onExitedRef = useRef(onExited);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    onExitedRef.current = onExited;
  }, [onExited]);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const requestClose = useCallback(() => {
    if (timerRef.current != null) return;
    if (prefersReducedMotion) {
      onExitedRef.current();
      return;
    }

    setIsExiting(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      onExitedRef.current();
    }, durationMs);
  }, [durationMs, prefersReducedMotion]);

  return { isExiting, requestClose };
}
