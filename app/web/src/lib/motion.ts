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
 * 首次有效图表在下一帧重放一次，后续 key 变化同步生效，避免数据切换时重放两次。
 */
export function useReplayKey(key: string, enabled = true): number {
  const [initialReplay, setInitialReplay] = useState(0);
  const counter = useRef(0);
  const prevKey = useRef<string | null>(null);
  const didInitialReplay = useRef(false);

  if (enabled && prevKey.current !== key) {
    if (prevKey.current !== null) counter.current += 1;
    prevKey.current = key;
  }

  useEffect(() => {
    if (!enabled || didInitialReplay.current || prevKey.current !== key) return;
    didInitialReplay.current = true;
    const frame = window.requestAnimationFrame(() => {
      setInitialReplay(1);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [enabled, key]);

  return counter.current + initialReplay;
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
