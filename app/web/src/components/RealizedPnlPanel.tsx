import { useState } from "react";
import type { Currency, RealizedAssetSummary, RealizedResponse } from "../types";
import {
  MARKET_LABEL,
  fmtNum,
  fmtPercent,
  fmtQty,
  fmtSigned,
  fmtTime,
  pnlColor,
} from "../lib/format";

interface Props {
  data: RealizedResponse | null;
  currency: Currency;
  loading: boolean;
}

/** 终端代码徽标：取代码主体，去掉市场后缀，最多 5 位 */
function badgeCode(symbol: string): string {
  const core = symbol.split(/[.:]/)[0] || symbol;
  return core.slice(0, 5).toUpperCase();
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function StatusBadge({ closed }: { closed: boolean }) {
  return closed ? (
    <span className="chip border border-[var(--border)] bg-[var(--surface-subtle)] px-1.5 text-[var(--text-dim)]">已清仓</span>
  ) : (
    <span className="chip border border-amber-500/30 bg-amber-500/15 px-1.5 text-amber-300">部分减仓</span>
  );
}

export function RealizedPnlPanel({ data, currency, loading }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const assets = data?.assets ?? [];
  const summary = data?.summary ?? null;

  return (
    <section className="panel p-4 sm:p-5 lg:col-span-2">
      <div className="flex flex-col gap-1">
        <div className="label">Realized</div>
        <h2 className="text-base font-semibold text-[var(--text)]">已实现盈亏 / 平仓记录</h2>
      </div>
      <p className="mt-2 text-sm text-[var(--text-dim)]">
        按加权平均法统计每笔卖出兑现的盈亏，已实现盈亏 =（卖出价 − 卖出当时均价）× 数量 − 该笔卖出费用。点击资产行可展开每笔卖出明细。
      </p>

      {summary && (
        <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <div className="panel panel-flat px-3.5 py-3">
            <div className="label">累计已实现盈亏</div>
            <div className={`tnum mt-1 text-lg font-semibold ${pnlColor(summary.total_realized_settled)}`}>
              {fmtSigned(summary.total_realized_settled, currency)}
            </div>
          </div>
          <div className="panel panel-flat px-3.5 py-3">
            <div className="label">已清仓</div>
            <div className="tnum mt-1 text-lg font-semibold text-[var(--text)]">{summary.closed_count}</div>
          </div>
          <div className="panel panel-flat px-3.5 py-3">
            <div className="label">部分减仓</div>
            <div className="tnum mt-1 text-lg font-semibold text-[var(--text)]">{summary.reduced_count}</div>
          </div>
        </div>
      )}

      {summary && !summary.fx_available && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3.5 py-2.5 text-xs text-amber-300">
          <span>⚠</span>
          <span>部分汇率不可用，受影响资产未计入汇总。{summary.warnings.join("；")}</span>
        </div>
      )}

      <div className="admin-table-shell mt-3">
        {/* 桌面端表格 */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[920px] table-fixed text-sm">
            <colgroup>
              <col className="w-[26%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[12%]" />
              <col className="w-[16%]" />
              <col className="w-[12%]" />
              <col className="w-[14%]" />
            </colgroup>
            <thead className="bg-[var(--surface-2)]">
              <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
                <th className="px-3 py-2.5 text-left font-medium">资产</th>
                <th className="px-3 py-2.5 text-center font-medium">状态</th>
                <th className="px-3 py-2.5 text-right font-medium">卖出笔数</th>
                <th className="px-3 py-2.5 text-right font-medium">累计卖出</th>
                <th className="px-3 py-2.5 text-right font-medium">已实现盈亏</th>
                <th className="px-3 py-2.5 text-right font-medium">收益率</th>
                <th className="px-3 py-2.5 text-right font-medium">最近卖出</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <AssetRows
                  key={a.asset.id}
                  summary={a}
                  currency={currency}
                  open={expanded.has(a.asset.id)}
                  onToggle={() => toggle(a.asset.id)}
                />
              ))}
              {assets.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-12 text-center text-sm text-[var(--text-faint)]">
                    {loading ? "加载中…" : "暂无平仓记录"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 移动端卡片 */}
        <div className="divide-y divide-white/[0.06] md:hidden">
          {assets.map((a) => (
            <MobileAssetCard
              key={a.asset.id}
              summary={a}
              currency={currency}
              open={expanded.has(a.asset.id)}
              onToggle={() => toggle(a.asset.id)}
            />
          ))}
          {assets.length === 0 && (
            <div className="px-3 py-12 text-center text-sm text-[var(--text-faint)]">
              {loading ? "加载中…" : "暂无平仓记录"}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function realizedPercentForSummary(a: RealizedAssetSummary): number | null {
  const basis = a.lots.reduce((sum, l) => sum + l.cost_basis, 0);
  return basis !== 0 ? (a.total_realized / basis) * 100 : null;
}

function AssetRows({
  summary: a,
  currency,
  open,
  onToggle,
}: {
  summary: RealizedAssetSummary;
  currency: Currency;
  open: boolean;
  onToggle: () => void;
}) {
  const pct = realizedPercentForSummary(a);
  return (
    <>
      <tr
        className="cursor-pointer border-b border-[var(--border)] transition-colors hover:bg-[var(--surface-hover)]"
        onClick={onToggle}
      >
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <span className="w-3 shrink-0 text-[var(--text-faint)]">{open ? "▾" : "▸"}</span>
            <span className="term-badge tnum shrink-0">{badgeCode(a.asset.symbol)}</span>
            <div className="min-w-0">
              <div className="truncate font-medium text-[var(--text)]">{a.asset.name || a.asset.symbol}</div>
              <div className="tnum text-xs text-[var(--text-faint)]">
                {a.asset.symbol} · {MARKET_LABEL[a.asset.market]}
              </div>
            </div>
          </div>
        </td>
        <td className="px-3 py-2.5 text-center">
          <StatusBadge closed={a.is_closed} />
        </td>
        <td className="tnum px-3 py-2.5 text-right text-[var(--text-dim)]">{a.sell_count}</td>
        <td className="tnum px-3 py-2.5 text-right text-[var(--text-dim)]">{fmtQty(a.total_sold_qty)}</td>
        <td className={`tnum px-3 py-2.5 text-right ${pnlColor(a.total_realized_settled)}`}>
          {a.total_realized_settled != null ? (
            <>
              {fmtSigned(a.total_realized_settled, currency)}
              {a.currency !== currency && (
                <div className="text-xs text-[var(--text-faint)]">{fmtSigned(a.total_realized, a.currency)}</div>
              )}
            </>
          ) : (
            <span className="text-xs text-[var(--text-faint)]">缺汇率</span>
          )}
        </td>
        <td className={`tnum px-3 py-2.5 text-right ${pnlColor(pct)}`}>{fmtPercent(pct)}</td>
        <td className="tnum px-3 py-2.5 text-right text-xs text-[var(--text-faint)]">{dateOnly(a.last_sell_at)}</td>
      </tr>
      {open && (
        <tr className="border-b border-[var(--border)] bg-[var(--surface-subtle)]">
          <td colSpan={7} className="px-3 py-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
                  <th className="px-2 py-1.5 text-left font-medium">卖出日期</th>
                  <th className="px-2 py-1.5 text-right font-medium">数量</th>
                  <th className="px-2 py-1.5 text-right font-medium">卖出价</th>
                  <th className="px-2 py-1.5 text-right font-medium">当时均价</th>
                  <th className="px-2 py-1.5 text-right font-medium">费用</th>
                  <th className="px-2 py-1.5 text-right font-medium">已实现盈亏({a.currency})</th>
                  <th className="px-2 py-1.5 text-right font-medium">收益率</th>
                </tr>
              </thead>
              <tbody>
                {a.lots.map((l, i) => (
                  <tr key={i} className="text-[var(--text-dim)]">
                    <td className="tnum px-2 py-1.5 text-left text-[var(--text-dim)]">{fmtTime(l.trade_time)}</td>
                    <td className="tnum px-2 py-1.5 text-right">{fmtQty(l.quantity)}</td>
                    <td className="tnum px-2 py-1.5 text-right">{fmtNum(l.sell_price, 4)}</td>
                    <td className="tnum px-2 py-1.5 text-right text-[var(--text-dim)]">{fmtNum(l.avg_cost, 4)}</td>
                    <td className="tnum px-2 py-1.5 text-right text-[var(--text-faint)]">{fmtNum(l.fee, 2)}</td>
                    <td className={`tnum px-2 py-1.5 text-right ${pnlColor(l.realized_pnl)}`}>
                      {fmtSigned(l.realized_pnl, a.currency)}
                    </td>
                    <td className={`tnum px-2 py-1.5 text-right ${pnlColor(l.realized_pnl_percent)}`}>
                      {fmtPercent(l.realized_pnl_percent)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

function MobileAssetCard({
  summary: a,
  currency,
  open,
  onToggle,
}: {
  summary: RealizedAssetSummary;
  currency: Currency;
  open: boolean;
  onToggle: () => void;
}) {
  const pct = realizedPercentForSummary(a);
  return (
    <div className="px-3 py-3">
      <button type="button" onClick={onToggle} className="flex w-full items-start justify-between gap-3 text-left">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="w-3 shrink-0 text-[var(--text-faint)]">{open ? "▾" : "▸"}</span>
          <span className="term-badge tnum shrink-0">{badgeCode(a.asset.symbol)}</span>
          <div className="min-w-0">
            <div className="truncate font-medium text-[var(--text)]">{a.asset.name || a.asset.symbol}</div>
            <div className="tnum mt-0.5 truncate text-xs text-[var(--text-faint)]">
              {a.asset.symbol} · {MARKET_LABEL[a.asset.market]} · 卖出 {a.sell_count} 笔
            </div>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={`tnum text-sm font-medium ${pnlColor(a.total_realized_settled)}`}>
            {a.total_realized_settled != null ? fmtSigned(a.total_realized_settled, currency) : "缺汇率"}
          </div>
          <div className="mt-0.5">
            <StatusBadge closed={a.is_closed} />
          </div>
        </div>
      </button>

      {open && (
        <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
          {a.lots.map((l, i) => (
            <div key={i} className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-2.5 py-2">
              <div className="flex items-center justify-between">
                <span className="tnum text-xs text-[var(--text-dim)]">{fmtTime(l.trade_time)}</span>
                <span className={`tnum text-sm font-medium ${pnlColor(l.realized_pnl)}`}>
                  {fmtSigned(l.realized_pnl, a.currency)}
                </span>
              </div>
              <div className="tnum mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-[var(--text-faint)]">
                <span>数量 {fmtQty(l.quantity)}</span>
                <span className="text-right">收益率 {fmtPercent(l.realized_pnl_percent)}</span>
                <span>卖出价 {fmtNum(l.sell_price, 4)}</span>
                <span className="text-right">均价 {fmtNum(l.avg_cost, 4)}</span>
              </div>
            </div>
          ))}
          <div className="tnum text-right text-[11px] text-[var(--text-faint)]">合计收益率 {fmtPercent(pct)}</div>
        </div>
      )}
    </div>
  );
}
