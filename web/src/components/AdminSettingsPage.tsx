import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api";
import type { AdminCaptcha, AdminSession, CustomTheme, Currency, DisplaySetting, FxResponse, Holding, Meta } from "../types";
import { fmtMoney, fmtNum, fmtPercent, fmtQty, pnlColor } from "../lib/format";
import { unitCostWithFee } from "../lib/position";
import { CUSTOM_THEME_FIELDS, DEFAULT_CUSTOM_THEME } from "../lib/theme";
import { fileToBackgroundDataUrl } from "../lib/image";
import { AddAssetModal } from "./AddAssetModal";
import { TransactionEditorModal } from "./TransactionEditorModal";
import { PaginationBar, useFixedTableHeight, usePagination } from "./Pagination";

interface Props {
  meta: Meta | null;
  currencies: Currency[];
  holdings: Holding[];
  settlementCurrency: Currency;
  onDisplayUpdated: (display: DisplaySetting) => void;
  onPortfolioChanged: () => void;
}

const inputCls = "input-base";
type ValidateButtonState = { status: "idle" | "running" | "success" | "failed"; reason: string | null };
type FxButtonState = { status: "idle" | "running" | "success" | "failed"; reason: string | null };
type SaveButtonState = { status: "idle" | "running" | "success" | "failed"; reason: string | null };

export function AdminSettingsPage({ meta, currencies, holdings, settlementCurrency, onDisplayUpdated, onPortfolioChanged }: Props) {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [display, setDisplay] = useState<DisplaySetting | null>(null);
  const [fx, setFx] = useState<FxResponse | null>(null);
  const [password, setPassword] = useState("");
  // 验证码由服务端下发与校验（答案不在前端）；为 null 时无需验证码
  const [captcha, setCaptcha] = useState<AdminCaptcha | null>(null);
  const [captchaInput, setCaptchaInput] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editingHolding, setEditingHolding] = useState<Holding | null>(null);
  const [archivingHolding, setArchivingHolding] = useState<Holding | null>(null);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [validateButton, setValidateButton] = useState<ValidateButtonState>({ status: "idle", reason: null });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // 修改密码表单的反馈直接在「更新密码」按钮旁展示，不进入页面底部的共享提示区
  const [pwdFeedback, setPwdFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const validateResetTimer = useRef<number | null>(null);
  const fxResetTimer = useRef<number | null>(null);
  const saveResetTimer = useRef<number | null>(null);
  const [fxButton, setFxButton] = useState<FxButtonState>({ status: "idle", reason: null });
  const [saveButton, setSaveButton] = useState<SaveButtonState>({ status: "idle", reason: null });

  // 资产配置列表分页 + 固定高度
  const { page, setPage, pageSize, setPageSize, pageCount, firstIndex, lastIndex } = usePagination(holdings.length);
  const pageHoldings = holdings.slice((page - 1) * pageSize, page * pageSize);
  const { headRef, bodyRef, bodyHeight, listHeight } = useFixedTableHeight(pageHoldings.length, pageSize);

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
      } else if (s.captcha_required) {
        setCaptcha(await api.adminCaptcha());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "后台状态加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    return () => {
      if (validateResetTimer.current != null) window.clearTimeout(validateResetTimer.current);
      if (fxResetTimer.current != null) window.clearTimeout(fxResetTimer.current);
      if (saveResetTimer.current != null) window.clearTimeout(saveResetTimer.current);
    };
  }, []);

  const assetLabel = (assetId: string): string => {
    const h = holdings.find((item) => item.asset.id === assetId);
    if (!h) return assetId;
    const name = h.asset.name || h.asset.symbol;
    return `${h.asset.symbol}${name !== h.asset.symbol ? `（${name}）` : ""}`;
  };

  const unlock = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (!password.trim()) {
      setError("请输入后台密码");
      return;
    }
    if (captcha && !captchaInput.trim()) {
      setError("请输入验证码");
      return;
    }
    try {
      const s = await api.adminUnlock(password, captcha ? { id: captcha.id, answer: captchaInput.trim() } : undefined);
      setSession(s);
      setPassword("");
      setCaptcha(null);
      setCaptchaInput("");
      const settings = await api.adminGetSettings();
      setDisplay(settings.display);
      setSession(settings.security);
      onDisplayUpdated(settings.display);
      setFx(await api.fx(settings.display.settlement_currency));
    } catch (e) {
      setError(e instanceof Error ? e.message : "解锁失败");
      // 服务端在失败时附带新验证码；用它刷新题面（答案仍只在服务端）
      const detail = e instanceof ApiError ? (e.detail as { captcha?: AdminCaptcha } | null) : null;
      if (detail?.captcha) setCaptcha(detail.captcha);
      else if (captcha) setCaptcha(await api.adminCaptcha().catch(() => captcha));
      setCaptchaInput("");
    }
  };

  const refreshCaptcha = async () => {
    setCaptchaInput("");
    try {
      setCaptcha(await api.adminCaptcha());
    } catch {
      /* 忽略：下次解锁失败会再下发 */
    }
  };

  const saveDisplay = async (e: FormEvent) => {
    e.preventDefault();
    if (!display) return;
    setSaveButton({ status: "running", reason: null });
    if (saveResetTimer.current != null) {
      window.clearTimeout(saveResetTimer.current);
      saveResetTimer.current = null;
    }
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
        pnl_up_color: display.pnl_up_color,
        pnl_down_color: display.pnl_down_color,
        pnl_flat_color: display.pnl_flat_color,
        custom_theme: display.theme === "custom" ? (display.custom_theme ?? DEFAULT_CUSTOM_THEME) : display.custom_theme,
        background_image: display.background_image,
        background_dim: display.background_dim,
        background_blur: display.background_blur,
      });
      setDisplay(res.display);
      setSession(res.security);
      onDisplayUpdated(res.display);
      setFx(await api.fx(res.display.settlement_currency));
      setSaveButton({ status: "success", reason: "显示设置已保存" });
      saveResetTimer.current = window.setTimeout(() => {
        setSaveButton((state) => (state.status === "success" ? { status: "idle", reason: null } : state));
        saveResetTimer.current = null;
      }, 3000);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) markLocked();
      else setSaveButton({ status: "failed", reason: e instanceof Error ? e.message : "保存失败" });
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwdFeedback(null);
    if (!currentPassword) return setPwdFeedback({ ok: false, text: "请输入当前密码" });
    if (newPassword.length < 4) return setPwdFeedback({ ok: false, text: "新密码至少 4 位" });
    if (newPassword !== confirmPassword) return setPwdFeedback({ ok: false, text: "两次输入的新密码不一致" });
    try {
      const res = await api.adminChangePassword(currentPassword, newPassword);
      setSession(res.security);
      setDisplay(null);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPwdFeedback({ ok: true, text: "已更新，请用新密码重新进入后台" });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && e.message === "请先输入后台密码") markLocked();
      else if (e instanceof ApiError && e.status === 401) setPwdFeedback({ ok: false, text: "当前密码错误" });
      else setPwdFeedback({ ok: false, text: e instanceof Error ? e.message : "密码修改失败" });
    }
  };

  const refreshFx = async () => {
    setFxButton({ status: "running", reason: null });
    if (fxResetTimer.current != null) {
      window.clearTimeout(fxResetTimer.current);
      fxResetTimer.current = null;
    }
    try {
      const res = await api.refreshFx();
      setFx(await api.fx(display?.settlement_currency ?? settlementCurrency));
      if (res && res.ok === false) {
        setFxButton({ status: "failed", reason: res.error ?? "汇率刷新失败" });
        return;
      }
      setFxButton({ status: "success", reason: "汇率已刷新" });
      fxResetTimer.current = window.setTimeout(() => {
        setFxButton((state) => (state.status === "success" ? { status: "idle", reason: null } : state));
        fxResetTimer.current = null;
      }, 3000);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) markLocked();
      else setFxButton({ status: "failed", reason: e instanceof Error ? e.message : "汇率刷新失败" });
    }
  };

  const validate = async () => {
    setValidating(true);
    setValidateButton({ status: "running", reason: null });
    if (validateResetTimer.current != null) {
      window.clearTimeout(validateResetTimer.current);
      validateResetTimer.current = null;
    }
    setError(null);
    setMessage(null);
    try {
      const res = await api.adminValidate();
      onPortfolioChanged();
      setFx(await api.fx(display?.settlement_currency ?? settlementCurrency));
      const { refresh, recompute } = res;
      if (refresh.failed > 0 || recompute.failed > 0) {
        const refreshFailed = refresh.failed_assets.map(assetLabel);
        const recomputeFailed = recompute.results
          .filter((r) => r.status === "failed")
          .map((r) => `${assetLabel(r.asset_id)}：${r.reason ?? "unknown"}`);
        const details = [
          refreshFailed.length > 0 ? `行情失败：${refreshFailed.join("、")}` : null,
          recomputeFailed.length > 0 ? `历史失败：${recomputeFailed.join("、")}` : null,
        ].filter(Boolean);
        setValidateButton({ status: "failed", reason: details.join("；") });
      } else {
        setValidateButton({
          status: "success",
          reason: `行情 ${refresh.succeeded}/${refresh.total}，历史重算 ${recompute.succeeded}/${recompute.total}，更新 ${recompute.rows} 条历史快照`,
        });
        validateResetTimer.current = window.setTimeout(() => {
          setValidateButton((state) => (state.status === "success" ? { status: "idle", reason: null } : state));
          validateResetTimer.current = null;
        }, 3000);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) markLocked();
      else setValidateButton({ status: "failed", reason: e instanceof Error ? e.message : "校验失败" });
    } finally {
      setValidating(false);
    }
  };

  const validateButtonText =
    validateButton.status === "running"
      ? "校验中..."
      : validateButton.status === "success"
        ? "已校验"
        : validateButton.status === "failed"
          ? "校验失败"
          : "校验";
  const validateButtonClass =
    validateButton.status === "success"
      ? "border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--surface-hover)]"
      : validateButton.status === "failed"
        ? "border-red-400/40 bg-red-500/10 text-red-300 hover:bg-red-500/15"
        : "text-slate-200";
  const validateButtonTitle =
    validateButton.status === "failed" || validateButton.status === "success"
      ? (validateButton.reason ?? validateButtonText)
      : "按当前资产配置重新拉取行情与历史价格并重算盈亏";
  const fxButtonText =
    fxButton.status === "running"
      ? "刷新中..."
      : fxButton.status === "success"
        ? "已刷新"
        : fxButton.status === "failed"
          ? "刷新失败"
          : "刷新汇率";
  const fxButtonClass =
    fxButton.status === "success"
      ? "border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--surface-hover)]"
      : fxButton.status === "failed"
        ? "border-red-400/40 bg-red-500/10 text-red-300 hover:bg-red-500/15"
        : "text-slate-200";
  const fxButtonTitle =
    fxButton.status === "failed" || fxButton.status === "success"
      ? (fxButton.reason ?? fxButtonText)
      : "按当前汇率来源刷新汇率";
  const saveButtonText =
    saveButton.status === "running"
      ? "保存中..."
      : saveButton.status === "success"
        ? "已保存"
        : saveButton.status === "failed"
          ? "保存失败"
          : "保存设置";
  const saveButtonClass =
    saveButton.status === "success"
      ? "border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--surface-hover)]"
      : saveButton.status === "failed"
        ? "border border-red-400/40 bg-red-500/10 text-red-300 hover:bg-red-500/15"
        : "";
  const saveButtonTitle =
    saveButton.status === "failed" || saveButton.status === "success"
      ? (saveButton.reason ?? saveButtonText)
      : "保存设置";

  const backHome = () => {
    window.location.hash = "#/";
  };

  const markLocked = () => {
    setSession({ unlocked: false, unlock_expires_at: null });
    setDisplay(null);
    setShowAdd(false);
    setEditingHolding(null);
    setArchivingHolding(null);
    setError("后台已锁定，请重新输入后台密码");
  };

  const unlocked = session?.unlocked === true;

  const updateDisplayDraft = (next: DisplaySetting) => {
    if (saveResetTimer.current != null) {
      window.clearTimeout(saveResetTimer.current);
      saveResetTimer.current = null;
    }
    setSaveButton((state) => (state.status === "success" ? { status: "idle", reason: null } : state));
    setDisplay(next);
  };

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
          <div className="mt-4">
            <label className="label">密码</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" className={`${inputCls} mt-1`} autoFocus />
          </div>
          {captcha && (
            <div className="mt-4">
              <label className="label">验证码</label>
              <div className="mt-1 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void refreshCaptcha()}
                  title="点击换一题"
                  className="tnum select-none rounded-md border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-slate-200 transition-colors hover:border-[var(--accent-line)]"
                >
                  {captcha.question} =
                </button>
                <input
                  value={captchaInput}
                  onChange={(e) => setCaptchaInput(e.target.value)}
                  inputMode="numeric"
                  placeholder="请输入计算结果"
                  className={`${inputCls} flex-1`}
                />
              </div>
            </div>
          )}
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
              <div className="flex items-center gap-2">
                <button
                  disabled={validating}
                  onClick={() => void validate()}
                  data-tooltip={validateButton.status === "failed" ? validateButtonTitle : undefined}
                  className={`tf-tooltip btn-ghost min-w-[72px] px-3 py-1.5 text-xs disabled:opacity-50 ${validateButtonClass}`}
                >
                  {validateButtonText}
                </button>
                <button disabled={!meta} onClick={() => setShowAdd(true)} className="btn-accent px-3.5 py-1.5 text-xs disabled:opacity-50">+ 添加资产</button>
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-500">当前持仓如下。点「校验」会按资产配置重新拉取行情与历史价格并重算盈亏。</p>
            <div className="mt-4 overflow-hidden rounded-xl border border-white/[0.06]">
              <div className="overflow-auto" style={{ height: listHeight ?? undefined }}>
              <table className="w-full text-sm">
                <thead ref={headRef} className="sticky top-0 z-10 bg-[var(--surface-2)] text-left text-[10px] uppercase tracking-[0.08em] text-slate-500 backdrop-blur-xl">
                  <tr>
                    <th className="px-3 py-2 font-medium">资产</th>
                    <th className="px-3 py-2 text-right font-medium">持仓</th>
                    <th className="px-3 py-2 text-right font-medium">成本(含费)</th>
                    <th className="px-3 py-2 text-right font-medium">最新价</th>
                    <th className="px-3 py-2 text-right font-medium">市值</th>
                    <th className="px-3 py-2 text-right font-medium">总盈亏</th>
                    <th className="px-3 py-2 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody ref={bodyRef}>
                  {pageHoldings.map((h) => (
                    <tr key={h.position.id} className="border-t border-white/[0.04]">
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-slate-100">{h.asset.name || h.asset.symbol}</div>
                        <div className="tnum text-xs text-slate-500">{h.asset.symbol} · {h.asset.asset_type === "FUND" ? "基金" : "股票"}</div>
                      </td>
                      <td className="tnum px-3 py-2.5 text-right text-slate-300">{fmtQty(h.position.quantity)}</td>
                      <td className="tnum px-3 py-2.5 text-right text-slate-400">{fmtNum(unitCostWithFee(h.position), 2)}</td>
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
                      <td colSpan={7} className="px-3 text-center text-sm text-slate-600" style={{ height: bodyHeight ?? 220 }}>暂无持仓，点击右上角添加资产。</td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
              {holdings.length > 0 && (
                <PaginationBar
                  page={page}
                  pageCount={pageCount}
                  pageSize={pageSize}
                  total={holdings.length}
                  firstIndex={firstIndex}
                  lastIndex={lastIndex}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                />
              )}
            </div>
          </section>

          {display && (
            <form onSubmit={saveDisplay} className="panel p-5 lg:col-span-2">
              <div className="label">Display</div>
              <h2 className="mt-1 text-base font-semibold text-slate-50">显示设置</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Field label="统一结算货币">
                  <ThemedSelect
                    value={display.settlement_currency}
                    options={currencies.map((c) => ({ value: c, label: c }))}
                    onChange={(v) => updateDisplayDraft({ ...display, settlement_currency: v as Currency })}
                  />
                </Field>
                <Field label="自动刷新间隔（秒）">
                  <input type="number" min={5} max={600} value={display.quote_refresh_interval} onChange={(e) => updateDisplayDraft({ ...display, quote_refresh_interval: Number(e.target.value) })} className={inputCls} />
                </Field>
                <Field label="主题">
                  <ThemedSelect
                    value={display.theme}
                    options={[
                      { value: "auto", label: "自动（跟随系统）" },
                      { value: "dark", label: "深色" },
                      { value: "light", label: "浅色" },
                      { value: "custom", label: "自定义" },
                    ]}
                    onChange={(v) => {
                      const theme = v as DisplaySetting["theme"];
                      // 切到自定义时给一份种子；切换即推送预览（不落库，保存按钮才持久化）
                      const next = {
                        ...display,
                        theme,
                        custom_theme: theme === "custom" ? (display.custom_theme ?? DEFAULT_CUSTOM_THEME) : display.custom_theme,
                      };
                      updateDisplayDraft(next);
                      onDisplayUpdated(next);
                    }}
                  />
                </Field>
                {display.theme === "custom" && (
                  <CustomThemeEditor
                    value={display.custom_theme ?? DEFAULT_CUSTOM_THEME}
                    onChange={(ct) => {
                      const next = { ...display, custom_theme: ct };
                      updateDisplayDraft(next);
                      onDisplayUpdated(next); // 实时预览
                    }}
                  />
                )}
                <BackgroundEditor
                  value={display}
                  onChange={(patch) => {
                    const next = { ...display, ...patch };
                    updateDisplayDraft(next);
                    onDisplayUpdated(next); // 实时预览
                  }}
                  onError={setError}
                />
                <Field label="涨跌配色">
                  <ThemedSelect
                    value={display.pnl_color_scheme}
                    options={[
                      { value: "green_up", label: "绿涨红跌（终端风格）" },
                      { value: "red_up", label: "红涨绿跌（A 股习惯）" },
                      { value: "custom", label: "自定义" },
                    ]}
                    onChange={(v) => {
                      const next = { ...display, pnl_color_scheme: v as DisplaySetting["pnl_color_scheme"] };
                      updateDisplayDraft(next);
                      onDisplayUpdated(next);
                    }}
                  />
                </Field>
                {display.pnl_color_scheme === "custom" && (
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 md:col-span-2">
                    <div className="label">自定义涨跌色</div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <ThemeColorControl
                        label="上涨"
                        value={display.pnl_up_color}
                        onChange={(color) => {
                          const next = { ...display, pnl_up_color: color };
                          updateDisplayDraft(next);
                          onDisplayUpdated(next);
                        }}
                      />
                      <ThemeColorControl
                        label="下跌"
                        value={display.pnl_down_color}
                        onChange={(color) => {
                          const next = { ...display, pnl_down_color: color };
                          updateDisplayDraft(next);
                          onDisplayUpdated(next);
                        }}
                      />
                      <ThemeColorControl
                        label="持平"
                        value={display.pnl_flat_color}
                        onChange={(color) => {
                          const next = { ...display, pnl_flat_color: color };
                          updateDisplayDraft(next);
                          onDisplayUpdated(next);
                        }}
                      />
                    </div>
                  </div>
                )}
                <Field label="汇率来源">
                  <ThemedSelect
                    value={display.exchange_rate_provider}
                    options={[
                      { value: "auto", label: "自动" },
                      { value: "exchangerate", label: "实时汇率 API" },
                      { value: "yahoo", label: "Yahoo FX" },
                      { value: "mock", label: "自定义" },
                    ]}
                    onChange={(v) => updateDisplayDraft({ ...display, exchange_rate_provider: v })}
                  />
                </Field>
                <label className="flex items-center gap-2 pt-6 text-sm text-slate-300">
                  <input type="checkbox" checked={display.show_original_currency} onChange={(e) => updateDisplayDraft({ ...display, show_original_currency: e.target.checked })} />
                  显示原币金额
                </label>
              </div>
              {fx && (
                <div className="mt-5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs text-slate-500">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>汇率来源：<span className="text-slate-300">{fxProviderLabel(fx.source ?? fx.provider_setting)}</span> · 更新时间：<span className="tnum text-slate-300">{fx.last_update ?? "—"}</span>{fx.stale && <span className="ml-2 text-amber-300">可能已过期</span>}</span>
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={fxButton.status === "running"}
                        data-tooltip={fxButton.status === "failed" ? fxButtonTitle : undefined}
                        onClick={() => void refreshFx()}
                        className={`tf-tooltip btn-ghost min-w-[82px] px-2.5 py-1 text-xs disabled:opacity-50 ${fxButtonClass}`}
                      >
                        {fxButtonText}
                      </button>
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {fx.rates.filter((r) => r.from !== r.to).map((r) => (
                      <span key={`${r.from}-${r.to}`} className="chip tnum">{r.from}→{r.to} {r.available ? r.rate.toFixed(4) : "不可用"}</span>
                    ))}
                  </div>
                </div>
              )}
              <button
                disabled={saveButton.status === "running"}
                data-tooltip={saveButton.status === "failed" ? saveButtonTitle : undefined}
                className={`tf-tooltip ${saveButton.status === "success" || saveButton.status === "failed" ? "btn-ghost" : "btn-accent"} mt-5 px-5 py-2 text-sm disabled:opacity-50 ${saveButtonClass}`}
                type="submit"
              >
                {saveButtonText}
              </button>
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
            <div className="mt-5 flex items-center gap-3">
              <button className="btn-ghost px-5 py-2 text-sm text-slate-200" type="submit">更新密码</button>
              {pwdFeedback && (
                <span className={`text-xs ${pwdFeedback.ok ? "text-emerald-300" : "text-red-400"}`}>
                  {pwdFeedback.text}
                </span>
              )}
            </div>
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
          onLocked={markLocked}
        />
      )}

      {editingHolding && (
        <TransactionEditorModal
          holding={editingHolding}
          onClose={() => setEditingHolding(null)}
          onChanged={onPortfolioChanged}
          onLocked={markLocked}
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
          onLocked={markLocked}
        />
      )}
    </main>
  );
}

function ArchivePositionModal({ holding, onClose, onArchived, onLocked }: { holding: Holding; onClose: () => void; onArchived: () => void; onLocked: () => void }) {
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
      if (e instanceof ApiError && e.status === 401) onLocked();
      else setError(e instanceof Error ? e.message : "清仓归档失败");
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

function ThemedSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value)?.label ?? value;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        className={`${inputCls} flex items-center justify-between gap-2 text-left`}
      >
        <span className="truncate">{current}</span>
        <span className="text-slate-500">⌄</span>
      </button>
      {open && (
        <div className="menu-pop absolute left-0 right-0 top-[calc(100%+0.35rem)] z-40 max-h-60 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--tooltip-bg)] py-1 shadow-[0_18px_48px_-24px_var(--shadow-panel)] backdrop-blur-xl">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={`block w-full px-3 py-2 text-left text-sm transition-colors ${
                option.value === value
                  ? "bg-[var(--accent-soft)] text-[var(--text)]"
                  : "text-[var(--text-dim)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function fxProviderLabel(value: string | null | undefined): string {
  switch (value) {
    case "auto":
      return "自动";
    case "exchangerate":
      return "实时汇率 API";
    case "yahoo":
      return "Yahoo FX";
    case "mock":
      return "自定义";
    case "identity":
      return "同币种";
    default:
      return value ?? "—";
  }
}

function CustomThemeEditor({ value, onChange }: { value: CustomTheme; onChange: (v: CustomTheme) => void }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 md:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="label">自定义配色</span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CUSTOM_THEME_FIELDS.map(({ key, label }) => (
          <ThemeColorControl
            key={key}
            label={label}
            value={value[key]}
            onChange={(color) => onChange({ ...value, [key]: color })}
          />
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        底座颜色决定页面背景基色；面板与边框会以半透明叠加在底座上。改动即时预览，点「保存设置」后持久化。
      </p>
    </div>
  );
}

function ThemeColorControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-[220px] items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-10 shrink-0 cursor-pointer rounded border border-white/10 bg-transparent p-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-slate-300">{label}</div>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputCls} mt-0.5 text-xs`}
          spellCheck={false}
        />
      </div>
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
        背景图全站生效，独立于主题。暗度与模糊用于压住复杂照片、保证数据与面板可读。改动即时预览，点「保存设置」后持久化。
      </p>
    </div>
  );
}
