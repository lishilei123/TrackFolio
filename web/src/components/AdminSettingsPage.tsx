import { type FormEvent, useEffect, useState } from "react";
import { ApiError, api } from "../api";
import type { AdminSession, CustomTheme, Currency, DisplaySetting, FxResponse, Holding, Meta } from "../types";
import { fmtMoney, fmtNum, fmtPercent, fmtQty, pnlColor } from "../lib/format";
import { CUSTOM_THEME_FIELDS, DEFAULT_CUSTOM_THEME } from "../lib/theme";
import { fileToBackgroundDataUrl } from "../lib/image";
import { AddAssetModal } from "./AddAssetModal";
import { TransactionEditorModal } from "./TransactionEditorModal";

interface Props {
  meta: Meta | null;
  currencies: Currency[];
  holdings: Holding[];
  settlementCurrency: Currency;
  onDisplayUpdated: (display: DisplaySetting) => void;
  onPortfolioChanged: () => void;
}

const inputCls = "input-base";

export function AdminSettingsPage({ meta, currencies, holdings, settlementCurrency, onDisplayUpdated, onPortfolioChanged }: Props) {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [display, setDisplay] = useState<DisplaySetting | null>(null);
  const [fx, setFx] = useState<FxResponse | null>(null);
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editingHolding, setEditingHolding] = useState<Holding | null>(null);
  const [archivingHolding, setArchivingHolding] = useState<Holding | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await api.adminSession();
      setSession(s);
      if (s.unlocked) {
        const settings = await api.adminGetSettings();
        setDisplay(settings.display);
        setSession(settings.security);
        onDisplayUpdated(settings.display);
        setFx(await api.fx(settings.display.settlement_currency));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "后台状态加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const unlock = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const s = await api.adminUnlock(password);
      setSession(s);
      setPassword("");
      const settings = await api.adminGetSettings();
      setDisplay(settings.display);
      setSession(settings.security);
      onDisplayUpdated(settings.display);
      setFx(await api.fx(settings.display.settlement_currency));
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? "密码错误" : e instanceof Error ? e.message : "解锁失败");
    }
  };

  const saveDisplay = async (e: FormEvent) => {
    e.preventDefault();
    if (!display) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.adminUpdateSettings({
        settlement_currency: display.settlement_currency,
        show_original_currency: display.show_original_currency,
        theme: display.theme,
        quote_refresh_interval: display.quote_refresh_interval,
        exchange_rate_provider: display.exchange_rate_provider,
        pnl_color_scheme: display.pnl_color_scheme,
        custom_theme: display.theme === "custom" ? (display.custom_theme ?? DEFAULT_CUSTOM_THEME) : display.custom_theme,
        background_image: display.background_image,
        background_dim: display.background_dim,
        background_blur: display.background_blur,
      });
      setDisplay(res.display);
      setSession(res.security);
      onDisplayUpdated(res.display);
      setFx(await api.fx(res.display.settlement_currency));
      setMessage("显示设置已保存");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setSession({ unlocked: false, unlock_expires_at: null });
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (newPassword !== confirmPassword) return setError("两次输入的新密码不一致");
    try {
      const res = await api.adminChangePassword(currentPassword, newPassword);
      setSession(res.security);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage("后台密码已更新");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setError("当前密码错误或后台已锁定");
      else setError(e instanceof Error ? e.message : "密码修改失败");
    }
  };

  const refreshFx = async () => {
    setError(null);
    setMessage(null);
    try {
      await api.refreshFx();
      setFx(await api.fx(display?.settlement_currency ?? settlementCurrency));
      setMessage("汇率已刷新");
    } catch (e) {
      setError(e instanceof Error ? e.message : "汇率刷新失败");
    }
  };

  const lock = async () => {
    const s = await api.adminLock();
    setSession(s);
    setDisplay(null);
    setMessage("后台已锁定");
  };

  const backHome = () => {
    window.location.hash = "#/";
  };

  const unlocked = session?.unlocked === true;

  return (
    <main className="fade-in mx-auto max-w-[1100px] space-y-5 px-5 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="label">Admin</div>
          <h1 className="mt-1 text-xl font-semibold text-slate-50">后台设置</h1>
        </div>
        <button onClick={backHome} className="btn-ghost px-3 py-1.5 text-xs text-slate-200">返回首页</button>
      </div>

      {loading ? (
        <div className="panel p-6 text-sm text-slate-500">正在检查后台状态...</div>
      ) : !unlocked ? (
        <form onSubmit={unlock} className="panel mx-auto max-w-md p-5">
          <h2 className="text-base font-semibold text-slate-50">输入后台密码</h2>
          <p className="mt-2 text-xs leading-5 text-slate-500">默认密码：admin。进入后台后建议尽快修改。</p>
          <div className="mt-4">
            <label className="label">密码</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" className={`${inputCls} mt-1`} autoFocus />
          </div>
          {error && <div className="mt-3 rounded bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>}
          {message && <div className="mt-3 rounded bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{message}</div>}
          <button className="btn-accent mt-4 w-full py-2 text-sm" type="submit">进入后台</button>
        </form>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <section className="panel p-5 lg:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="label">Assets</div>
                <h2 className="mt-1 text-base font-semibold text-slate-50">资产配置</h2>
              </div>
              <button disabled={!meta} onClick={() => setShowAdd(true)} className="btn-accent px-3.5 py-1.5 text-xs disabled:opacity-50">+ 添加资产</button>
            </div>
            <p className="mt-3 text-sm text-slate-500">当前持仓如下。这里后续会继续扩展交易编辑、资产管理等后台功能。</p>
            <div className="mt-4 overflow-hidden rounded-xl border border-white/[0.06]">
              <table className="w-full text-sm">
                <thead className="bg-white/[0.02] text-left text-[10px] uppercase tracking-[0.08em] text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">资产</th>
                    <th className="px-3 py-2 text-right font-medium">持仓</th>
                    <th className="px-3 py-2 text-right font-medium">成本</th>
                    <th className="px-3 py-2 text-right font-medium">最新价</th>
                    <th className="px-3 py-2 text-right font-medium">市值</th>
                    <th className="px-3 py-2 text-right font-medium">总盈亏</th>
                    <th className="px-3 py-2 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h) => (
                    <tr key={h.position.id} className="border-t border-white/[0.04]">
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-slate-100">{h.asset.name || h.asset.symbol}</div>
                        <div className="tnum text-xs text-slate-500">{h.asset.symbol} · {h.asset.asset_type === "FUND" ? "基金" : "股票"}</div>
                      </td>
                      <td className="tnum px-3 py-2.5 text-right text-slate-300">{fmtQty(h.position.quantity)}</td>
                      <td className="tnum px-3 py-2.5 text-right text-slate-400">{fmtNum(h.position.avg_cost, 2)}</td>
                      <td className="tnum px-3 py-2.5 text-right text-slate-300">{fmtNum(h.latest, h.is_nav_based ? 4 : 2)}</td>
                      <td className="tnum px-3 py-2.5 text-right text-slate-100">{fmtMoney(h.market_value_settled, settlementCurrency)}</td>
                      <td className={`tnum px-3 py-2.5 text-right ${pnlColor(h.total_pnl_settled)}`}>
                        {fmtMoney(h.total_pnl_settled, settlementCurrency)}
                        <div className="text-xs opacity-80">{fmtPercent(h.total_pnl.percent)}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        <button onClick={() => setEditingHolding(h)} className="btn-ghost mr-1 px-2 py-1 text-xs text-slate-200">编辑交易</button>
                        <button onClick={() => setArchivingHolding(h)} className="rounded-md px-2 py-1 text-xs text-amber-300 hover:bg-amber-500/10">清仓归档</button>
                      </td>
                    </tr>
                  ))}
                  {holdings.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-600">暂无持仓，点击右上角添加资产。</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="label">Security</div>
                <h2 className="mt-1 text-base font-semibold text-slate-50">后台状态</h2>
              </div>
              <button onClick={() => void lock()} className="btn-ghost px-3 py-1.5 text-xs text-slate-200">锁定</button>
            </div>
            <p className="mt-3 text-xs text-slate-500">解锁有效期至：<span className="tnum text-slate-300">{session.unlock_expires_at ?? "—"}</span></p>
          </section>

          {display && (
            <form onSubmit={saveDisplay} className="panel p-5 lg:col-span-2">
              <div className="label">Display</div>
              <h2 className="mt-1 text-base font-semibold text-slate-50">显示设置</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Field label="统一结算货币">
                  <select value={display.settlement_currency} onChange={(e) => setDisplay({ ...display, settlement_currency: e.target.value as Currency })} className={inputCls}>
                    {currencies.map((c) => <option key={c} value={c} className="bg-slate-900">{c}</option>)}
                  </select>
                </Field>
                <Field label="自动刷新间隔（秒）">
                  <input type="number" min={5} max={600} value={display.quote_refresh_interval} onChange={(e) => setDisplay({ ...display, quote_refresh_interval: Number(e.target.value) })} className={inputCls} />
                </Field>
                <Field label="主题">
                  <select
                    value={display.theme}
                    onChange={(e) => {
                      const theme = e.target.value as DisplaySetting["theme"];
                      // 切到自定义时给一份种子；切换即推送预览（不落库，保存按钮才持久化）
                      const next = {
                        ...display,
                        theme,
                        custom_theme: theme === "custom" ? (display.custom_theme ?? DEFAULT_CUSTOM_THEME) : display.custom_theme,
                      };
                      setDisplay(next);
                      onDisplayUpdated(next);
                    }}
                    className={inputCls}
                  >
                    <option value="auto" className="bg-slate-900">自动（跟随系统）</option>
                    <option value="dark" className="bg-slate-900">深色</option>
                    <option value="light" className="bg-slate-900">浅色</option>
                    <option value="custom" className="bg-slate-900">自定义</option>
                  </select>
                </Field>
                {display.theme === "custom" && (
                  <CustomThemeEditor
                    value={display.custom_theme ?? DEFAULT_CUSTOM_THEME}
                    onChange={(ct) => {
                      const next = { ...display, custom_theme: ct };
                      setDisplay(next);
                      onDisplayUpdated(next); // 实时预览
                    }}
                  />
                )}
                <BackgroundEditor
                  value={display}
                  onChange={(patch) => {
                    const next = { ...display, ...patch };
                    setDisplay(next);
                    onDisplayUpdated(next); // 实时预览
                  }}
                  onError={setError}
                />
                <Field label="涨跌配色">
                  <select value={display.pnl_color_scheme} onChange={(e) => setDisplay({ ...display, pnl_color_scheme: e.target.value as DisplaySetting["pnl_color_scheme"] })} className={inputCls}>
                    <option value="green_up" className="bg-slate-900">绿涨红跌（终端风格）</option>
                    <option value="red_up" className="bg-slate-900">红涨绿跌（A 股习惯）</option>
                  </select>
                </Field>
                <Field label="汇率 Provider">
                  <select value={display.exchange_rate_provider} onChange={(e) => setDisplay({ ...display, exchange_rate_provider: e.target.value })} className={inputCls}>
                    <option value="auto" className="bg-slate-900">自动</option>
                    <option value="exchangerate" className="bg-slate-900">实时汇率 API</option>
                    <option value="yahoo" className="bg-slate-900">Yahoo FX</option>
                    <option value="mock" className="bg-slate-900">Mock 固定汇率</option>
                  </select>
                </Field>
                <label className="flex items-center gap-2 pt-6 text-sm text-slate-300">
                  <input type="checkbox" checked={display.show_original_currency} onChange={(e) => setDisplay({ ...display, show_original_currency: e.target.checked })} />
                  显示原币金额
                </label>
              </div>
              {fx && (
                <div className="mt-5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs text-slate-500">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>汇率来源：<span className="text-slate-300">{fx.source ?? fx.provider_setting}</span> · 更新时间：<span className="tnum text-slate-300">{fx.last_update ?? "—"}</span>{fx.stale && <span className="ml-2 text-amber-300">可能已过期</span>}</span>
                    <button type="button" onClick={() => void refreshFx()} className="btn-ghost px-2.5 py-1 text-xs text-slate-200">刷新汇率</button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {fx.rates.filter((r) => r.from !== r.to).map((r) => (
                      <span key={`${r.from}-${r.to}`} className="chip tnum">{r.from}→{r.to} {r.available ? r.rate.toFixed(4) : "不可用"}</span>
                    ))}
                  </div>
                </div>
              )}
              <button disabled={saving} className="btn-accent mt-5 px-5 py-2 text-sm disabled:opacity-50" type="submit">{saving ? "保存中..." : "保存显示设置"}</button>
            </form>
          )}

          <form onSubmit={changePassword} className="panel p-5 lg:col-span-2">
            <div className="label">Password</div>
            <h2 className="mt-1 text-base font-semibold text-slate-50">修改后台密码</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <Field label="当前密码"><input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className={inputCls} /></Field>
              <Field label="新密码"><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={inputCls} /></Field>
              <Field label="确认新密码"><input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputCls} /></Field>
            </div>
            <button className="btn-ghost mt-5 px-5 py-2 text-sm text-slate-200" type="submit">更新密码</button>
          </form>
        </div>
      )}

      {unlocked && error && <div className="rounded bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>}
      {unlocked && message && <div className="rounded bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{message}</div>}

      {showAdd && meta && (
        <AddAssetModal
          meta={meta}
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            onPortfolioChanged();
            setShowAdd(false);
          }}
        />
      )}

      {editingHolding && (
        <TransactionEditorModal
          holding={editingHolding}
          onClose={() => setEditingHolding(null)}
          onChanged={onPortfolioChanged}
        />
      )}

      {archivingHolding && (
        <ArchivePositionModal
          holding={archivingHolding}
          onClose={() => setArchivingHolding(null)}
          onArchived={() => {
            onPortfolioChanged();
            setArchivingHolding(null);
            setMessage("已清仓归档，历史记录已保留");
          }}
        />
      )}
    </main>
  );
}

function ArchivePositionModal({ holding, onClose, onArchived }: { holding: Holding; onClose: () => void; onArchived: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [price, setPrice] = useState(holding.latest != null ? String(holding.latest) : "");
  const [fee, setFee] = useState("0");
  const [tradeTime, setTradeTime] = useState(today);
  const [note, setNote] = useState("清仓归档");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const px = Number(price);
    const f = Number(fee) || 0;
    if (!Number.isFinite(px) || px < 0) return setError("请填写有效的清仓价格");
    if (!Number.isFinite(f) || f < 0) return setError("请填写有效的交易费用");
    setSubmitting(true);
    try {
      await api.closePosition(holding.position.id, {
        price: px,
        fee: f,
        trade_time: tradeTime || null,
        note: note.trim() || "清仓归档",
      });
      onArchived();
    } catch (e) {
      setError(e instanceof Error ? e.message : "清仓归档失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto modal-backdrop p-4 pt-16 backdrop-blur-md" onClick={onClose}>
      <form onSubmit={submit} className="panel fade-in w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="label">Archive</div>
            <h2 className="text-base font-semibold text-slate-50">清仓归档</h2>
          </div>
          <button type="button" onClick={onClose} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-slate-200">✕</button>
        </div>
        <p className="text-sm leading-6 text-slate-500">
          将按剩余持仓数量新增一笔卖出交易，资产和历史记录不会删除；清仓后首页不再显示该持仓。
        </p>
        <div className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-sm">
          <div className="font-medium text-slate-100">{holding.asset.name || holding.asset.symbol}</div>
          <div className="tnum mt-1 text-xs text-slate-500">{holding.asset.symbol} · 剩余 {fmtQty(holding.position.quantity)}</div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="清仓价格"><input value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} inputMode="decimal" autoFocus /></Field>
          <Field label="交易费用"><input value={fee} onChange={(e) => setFee(e.target.value)} className={inputCls} inputMode="decimal" /></Field>
          <Field label="清仓日期"><input type="date" value={tradeTime} onChange={(e) => setTradeTime(e.target.value)} className={inputCls} /></Field>
          <Field label="备注"><input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} /></Field>
        </div>
        {error && <div className="mt-3 rounded bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost px-4 py-2 text-sm text-slate-300">取消</button>
          <button disabled={submitting} type="submit" className="btn-accent px-4 py-2 text-sm disabled:opacity-50">确认清仓归档</button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function CustomThemeEditor({ value, onChange }: { value: CustomTheme; onChange: (v: CustomTheme) => void }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 md:col-span-2">
      <div className="flex items-center justify-between gap-3">
        <span className="label">自定义配色</span>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <span>底座</span>
          <select
            value={value.base}
            onChange={(e) => onChange({ ...value, base: e.target.value as CustomTheme["base"] })}
            className={`${inputCls} w-auto`}
          >
            <option value="dark" className="bg-slate-900">深色</option>
            <option value="light" className="bg-slate-900">浅色</option>
          </select>
        </label>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CUSTOM_THEME_FIELDS.map(({ key, label }) => (
          <div key={key} className="flex items-center gap-2">
            <input
              type="color"
              value={value[key]}
              onChange={(e) => onChange({ ...value, [key]: e.target.value })}
              className="h-9 w-10 shrink-0 cursor-pointer rounded border border-white/10 bg-transparent p-0.5"
              title={label}
            />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-slate-300">{label}</div>
              <input
                value={value[key]}
                onChange={(e) => onChange({ ...value, [key]: e.target.value })}
                className={`${inputCls} mt-0.5 text-xs`}
                spellCheck={false}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        面板与边框会以半透明叠加在背景上，保留玻璃质感；强调色会自动派生柔光、描边与按钮文字色。改动即时预览，点「保存显示设置」后持久化。
      </p>
    </div>
  );
}

function BackgroundEditor({
  value,
  onChange,
  onError,
}: {
  value: DisplaySetting;
  onChange: (patch: Partial<DisplaySetting>) => void;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await fileToBackgroundDataUrl(file);
      onChange({ background_image: dataUrl });
    } catch (e) {
      onError(e instanceof Error ? e.message : "图片处理失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 md:col-span-2">
      <div className="flex items-center justify-between gap-3">
        <span className="label">背景图</span>
        {value.background_image && (
          <button
            type="button"
            onClick={() => onChange({ background_image: null })}
            className="btn-ghost px-2.5 py-1 text-xs text-slate-200"
          >
            移除
          </button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <div
          className="h-16 w-28 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/[0.03] bg-cover bg-center"
          style={value.background_image ? { backgroundImage: `url("${value.background_image}")` } : undefined}
        >
          {!value.background_image && (
            <div className="grid h-full w-full place-items-center text-xs text-slate-500">无</div>
          )}
        </div>
        <label className="btn-ghost cursor-pointer px-3 py-1.5 text-xs text-slate-200">
          {busy ? "处理中..." : value.background_image ? "更换图片" : "上传图片"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = ""; // 允许再次选同一文件
            }}
          />
        </label>
        <span className="text-xs text-slate-500">上传后会自动压缩；建议横向风景图。</span>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs text-slate-300">暗度遮罩 {Math.round(value.background_dim * 100)}%</span>
          <input
            type="range"
            min={0}
            max={0.9}
            step={0.05}
            value={value.background_dim}
            onChange={(e) => onChange({ background_dim: Number(e.target.value) })}
            className="mt-1 w-full accent-[var(--accent)]"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-300">模糊 {value.background_blur}px</span>
          <input
            type="range"
            min={0}
            max={40}
            step={1}
            value={value.background_blur}
            onChange={(e) => onChange({ background_blur: Number(e.target.value) })}
            className="mt-1 w-full accent-[var(--accent)]"
          />
        </label>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        背景图全站生效，独立于主题。暗度与模糊用于压住复杂照片、保证数据与面板可读。改动即时预览，点「保存显示设置」后持久化。
      </p>
    </div>
  );
}
