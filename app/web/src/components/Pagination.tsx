import { useEffect, useLayoutEffect, useRef, useState } from "react";

export const PAGE_SIZE_OPTIONS = [5, 10, 20] as const;

/**
 * 固定高度 = 表头高 + 每页行数 × 单行高，使「满页」正好填满、不留白也不滚动。
 * visibleRows 为当前页实际渲染的数据行数；extraDeps 用于行高随其它状态变化时重新测量。
 */
export function useFixedTableHeight(visibleRows: number, pageSize: number, extraDeps: unknown[] = []) {
  const headRef = useRef<HTMLTableSectionElement>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const [headHeight, setHeadHeight] = useState(0);
  const [rowHeight, setRowHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (headRef.current) setHeadHeight(headRef.current.offsetHeight);
    // 仅用真实数据行测量行高；空列表时沿用上次测得的行高，保证有/无数据高度一致
    if (visibleRows > 0) {
      const firstRow = bodyRef.current?.querySelector("tr") as HTMLElement | null;
      if (firstRow) setRowHeight(firstRow.offsetHeight);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRows, ...extraDeps]);
  const bodyHeight = rowHeight ? rowHeight * pageSize : null;
  const listHeight = bodyHeight ? headHeight + bodyHeight : null;
  return { headRef, bodyRef, bodyHeight, listHeight };
}

/** 分页状态：钳制越界页码，并算出当前页的索引区间 */
export function usePagination(total: number, initialPageSize: number = PAGE_SIZE_OPTIONS[0]) {
  const [pageSize, setPageSize] = useState<number>(initialPageSize);
  const [page, setPage] = useState(1);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // 行数变化导致当前页越界时，回退到最后一页
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const safePage = Math.min(page, pageCount);
  const firstIndex = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const lastIndex = Math.min(safePage * pageSize, total);

  return { page: safePage, setPage, pageSize, setPageSize, pageCount, firstIndex, lastIndex };
}

/** 分页栏：每页条数选择 + 当前区间 + 翻页按钮 */
export function PaginationBar({
  page,
  pageCount,
  pageSize,
  total,
  firstIndex,
  lastIndex,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  firstIndex: number;
  lastIndex: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  return (
    <div className="grid gap-2 border-t border-white/[0.06] px-3 py-2 text-xs text-slate-400 sm:flex sm:items-center sm:justify-between sm:gap-3 sm:py-2.5">
      <div className="flex items-center justify-between gap-2 sm:justify-start">
        <div className="flex items-center gap-2">
          <span className="label">每页</span>
          <PageSizeSelect value={pageSize} onChange={onPageSizeChange} />
          <span>条</span>
        </div>

        <span className="tnum text-slate-500">
          {firstIndex}–{lastIndex} / {total}
        </span>
      </div>

      <div className="flex items-center justify-center gap-2 sm:ml-auto sm:w-auto sm:justify-end sm:gap-1.5">
        <PageBtn className="hidden sm:grid" disabled={page <= 1} onClick={() => onPageChange(1)}>
          «
        </PageBtn>
        <PageBtn disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))}>
          ‹
        </PageBtn>
        <span className="tnum px-1 text-center text-slate-400">
          {page} / {pageCount}
        </span>
        <PageBtn disabled={page >= pageCount} onClick={() => onPageChange(Math.min(pageCount, page + 1))}>
          ›
        </PageBtn>
        <PageBtn className="hidden sm:grid" disabled={page >= pageCount} onClick={() => onPageChange(pageCount)}>
          »
        </PageBtn>
      </div>
    </div>
  );
}

export function PageSizeSelect({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="tnum flex w-14 items-center justify-between gap-1 rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-2 py-1 text-xs font-semibold text-[var(--accent)] outline-none transition-colors hover:border-[var(--accent-line)] focus:border-[var(--accent-line)] focus:shadow-[0_0_0_3px_var(--accent-soft)]"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="每页显示条数"
      >
        <span>{value}</span>
        <svg
          className={`h-3 w-3 text-[var(--text-faint)] transition-transform ${open ? "" : "rotate-180"}`}
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden
        >
          <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="每页显示条数"
          className="menu-pop absolute bottom-[calc(100%+0.35rem)] left-0 z-30 w-14 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--tooltip-bg)] py-1 shadow-[0_14px_34px_-20px_var(--shadow-panel)] backdrop-blur-xl"
        >
          {PAGE_SIZE_OPTIONS.map((n) => {
            const active = n === value;
            return (
              <button
                key={n}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(n);
                  setOpen(false);
                }}
                className={`tnum flex w-full items-center justify-between gap-1 px-2 py-1.5 text-left text-xs transition-colors ${
                  active
                    ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent)]"
                    : "text-[var(--text-dim)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                }`}
              >
                <span>{n}</span>
                {active && <span className="text-[10px]">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function PageBtn({
  children,
  onClick,
  disabled,
  className = "",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`tnum grid h-7 min-w-7 place-items-center rounded-[5px] border border-white/[0.08] bg-white/[0.03] px-1.5 text-slate-300 transition-colors hover:border-[var(--accent-line)] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-white/[0.08] disabled:hover:text-slate-300 sm:h-6 sm:min-w-6 ${className}`}
    >
      {children}
    </button>
  );
}
