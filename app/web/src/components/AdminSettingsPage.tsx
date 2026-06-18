import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "../api";
import type { AdminCaptcha, AdminSession, AllocationExportFile, CustomTheme, Currency, DisplaySetting, FxResponse, Holding, Meta } from "../types";
import { fmtMoney, fmtNum, fmtPercent, fmtQty, pnlColor } from "../lib/format";
import { useExitTransition } from "../lib/motion";
import { unitCostWithFee } from "../lib/position";
import { CUSTOM_THEME_FIELDS, DEFAULT_CUSTOM_THEME } from "../lib/theme";
import { fileToBackgroundDataUrl } from "../lib/image";
import { AddAssetModal } from "./AddAssetModal";
import { DateField } from "./DateField";
import { GlassLoader } from "./GlassLoader";
import { TransactionEditorModal } from "./TransactionEditorModal";
import { PaginationBar, useFixedTableHeight, usePagination } from "./Pagination";

interface Props {
  meta: Meta | null;
  currencies: Currency[];
  holdings: Holding[];
  settlementCurrency: Currency;
  onDisplayUpdated: (display: DisplaySetting) => void;
  onPortfolioChanged: () => void | Promise<void>;
  onLocked: () => void;
}

const inputCls = "input-base";
const DEFAULT_SETTLEMENT_TIMEZONE = "Asia/Shanghai";
const REMOVED_SETTLEMENT_TIMEZONE = "Asia/Hong_Kong";
type ValidateButtonState = { status: "idle" | "running" | "success" | "failed"; reason: string | null };
type FxButtonState = { status: "idle" | "running" | "success" | "failed"; reason: string | null };
type SaveButtonState = { status: "idle" | "running" | "success" | "failed"; reason: string | null };
type UnlockButtonState = { status: "idle" | "running" | "failed"; reason: string | null };
type PasswordButtonState = { status: "idle" | "running" | "success" };
type AllocationAction = "import" | "export";
type AllocationBusyState = AllocationAction | null;
type AllocationFeedback = { action: AllocationAction; ok: boolean; text: string } | null;
type HoldingSortKey = "quantity" | "unit_cost" | "latest" | "market_value" | "total_pnl";
type PasswordFeedbackField = "current" | "new" | "confirm" | "form";
type PasswordFeedback = { ok: boolean; text: string; field: PasswordFeedbackField };

const TIMEZONE_OPTIONS = [
  { value: DEFAULT_SETTLEMENT_TIMEZONE, label: "北京时间（Asia/Shanghai）" },
  { value: "America/New_York", label: "美东时间（America/New_York）" },
  { value: "UTC", label: "UTC" },
];

function normalizeDisplaySetting(display: DisplaySetting): DisplaySetting {
  const normalized =
    display.settlement_timezone === REMOVED_SETTLEMENT_TIMEZONE
      ? { ...display, settlement_timezone: DEFAULT_SETTLEMENT_TIMEZONE }
      : display;
  return {
    ...normalized,
    use_us_premarket_pnl: normalized.use_us_premarket_pnl ?? true,
    use_us_postmarket_pnl: normalized.use_us_postmarket_pnl ?? true,
  };
}

function timezoneOptionsFor(value: string): Array<{ value: string; label: string }> {
  if (TIMEZONE_OPTIONS.some((tz) => tz.value === value)) return TIMEZONE_OPTIONS;
  if (value === REMOVED_SETTLEMENT_TIMEZONE) return TIMEZONE_OPTIONS;
  return [{ value, label: value }, ...TIMEZONE_OPTIONS];
}

const ADMIN_MOBILE_SORT_OPTIONS: Array<{ key: HoldingSortKey; label: string }> = [
  { key: "quantity", label: "持仓" },
  { key: "unit_cost", label: "成本" },
  { key: "latest", label: "最新价" },
  { key: "market_value", label: "市值" },
  { key: "total_pnl", label: "盈亏" },
];

export function AdminSettingsPage({ meta, currencies, holdings, settlementCurrency, onDisplayUpdated, onPortfolioChanged, onLocked }: Props) {
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
  const [allocationBusy, setAllocationBusy] = useState<AllocationBusyState>(null);
  const [allocationFeedback, setAllocationFeedback] = useState<AllocationFeedback>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const allocationResetTimer = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pwdFeedback, setPwdFeedback] = useState<PasswordFeedback | null>(null);
  const validateResetTimer = useRef<number | null>(null);
  const fxResetTimer = useRef<number | null>(null);
  const saveResetTimer = useRef<number | null>(null);
  const unlockResetTimer = useRef<number | null>(null);
  const passwordReloginTimer = useRef<number | null>(null);
  const [fxButton, setFxButton] = useState<FxButtonState>({ status: "idle", reason: null });
  const [saveButton, setSaveButton] = useState<SaveButtonState>({ status: "idle", reason: null });
  const [unlockButton, setUnlockButton] = useState<UnlockButtonState>({ status: "idle", reason: null });
  const [passwordButton, setPasswordButton] = useState<PasswordButtonState>({ status: "idle" });
  const [passwordCountdown, setPasswordCountdown] = useState<number | null>(null);

  // 资产配置列表排序
  const [sortKey, setSortKey] = useState<HoldingSortKey | null>(null);
  const [sortAsc, setSortAsc] = useState(false);
  const sortedHoldings = useMemo(() => {
    if (!sortKey) return holdings;
    const val = (h: Holding): number => {
      switch (sortKey) {
        case "quantity":
          return h.position.quantity ?? -Infinity;
        case "unit_cost":
          return unitCostWithFee(h.position) ?? -Infinity;
        case "latest":
          return h.latest ?? -Infinity;
        case "market_value":
          return h.market_value_settled ?? -Infinity;
        case "total_pnl":
          return h.total_pnl_settled ?? -Infinity;
      }
    };
    return [...holdings].sort((a, b) => (sortAsc ? val(a) - val(b) : val(b) - val(a)));
  }, [holdings, sortKey, sortAsc]);

  const toggleSort = (key: HoldingSortKey) => {
    // 三态循环：降序 → 升序 → 取消排序（恢复默认顺序）
    if (sortKey !== key) {
      setSortKey(key);
      setSortAsc(false);
    } else if (!sortAsc) {
      setSortAsc(true);
    } else {
      setSortKey(null);
      setSortAsc(false);
    }
  };
  const sortArrow = (key: HoldingSortKey) => (sortKey === key ? (sortAsc ? " ↑" : " ↓") : "");

  // 资产配置列表分页 + 固定高度
  const { page, setPage, pageSize, setPageSize, pageCount, firstIndex, lastIndex } = usePagination(sortedHoldings.length);
  const pageHoldings = sortedHoldings.slice((page - 1) * pageSize, page * pageSize);
  const { headRef, bodyRef, bodyHeight, listHeight } = useFixedTableHeight(pageHoldings.length, pageSize);

  // 切换排序时回到第一页
  useEffect(() => {
    setPage(1);
  }, [sortKey, sortAsc, setPage]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await api.adminSession();
      setSession(s);
      if (s.unlocked) {
        const settings = await api.adminGetSettings();
        const displaySetting = normalizeDisplaySetting(settings.display);
        setDisplay(displaySetting);
        setSession(settings.security);
        onDisplayUpdated(displaySetting);
        setFx(await api.fx(displaySetting.settlement_currency));
      } else {
        onLocked();
        if (s.captcha_required) setCaptcha(await api.adminCaptcha());
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
      if (allocationResetTimer.current != null) window.clearTimeout(allocationResetTimer.current);
      if (fxResetTimer.current != null) window.clearTimeout(fxResetTimer.current);
      if (saveResetTimer.current != null) window.clearTimeout(saveResetTimer.current);
      if (unlockResetTimer.current != null) window.clearTimeout(unlockResetTimer.current);
      if (passwordReloginTimer.current != null) window.clearInterval(passwordReloginTimer.current);
    };
  }, []);

  const assetLabel = (assetId: string): string => {
    const h = holdings.find((item) => item.asset.id === assetId);
    if (!h) return assetId;
    const name = h.asset.name || h.asset.symbol;
    return `${h.asset.symbol}${name !== h.asset.symbol ? `（${name}）` : ""}`;
  };

  const showUnlockFeedback = (reason: string) => {
    if (unlockResetTimer.current != null) window.clearTimeout(unlockResetTimer.current);
    setUnlockButton({ status: "failed", reason });
    unlockResetTimer.current = window.setTimeout(() => {
      setUnlockButton((state) => (state.status === "failed" ? { status: "idle", reason: null } : state));
      unlockResetTimer.current = null;
    }, 3000);
  };

  const unlock = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (!password.trim()) {
      showUnlockFeedback("请输入后台密码");
      return;
    }
    if (captcha && !captchaInput.trim()) {
      showUnlockFeedback("请输入验证码");
      return;
    }
    if (unlockResetTimer.current != null) {
      window.clearTimeout(unlockResetTimer.current);
      unlockResetTimer.current = null;
    }
    setUnlockButton({ status: "running", reason: null });
    try {
      const s = await api.adminUnlock(password, captcha ? { id: captcha.id, answer: captchaInput.trim() } : undefined);
      setSession(s);
      setPassword("");
      setCaptcha(null);
      setCaptchaInput("");
      setUnlockButton({ status: "idle", reason: null });
      const settings = await api.adminGetSettings();
      const displaySetting = normalizeDisplaySetting(settings.display);
      setDisplay(displaySetting);
      setSession(settings.security);
      onDisplayUpdated(displaySetting);
      setFx(await api.fx(displaySetting.settlement_currency));
      onPortfolioChanged();
    } catch (e) {
      showUnlockFeedback(e instanceof Error ? e.message : "解锁失败");
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
        settlement_timezone:
          display.settlement_timezone === REMOVED_SETTLEMENT_TIMEZONE
            ? DEFAULT_SETTLEMENT_TIMEZONE
            : display.settlement_timezone,
        show_original_currency: display.show_original_currency,
        use_us_premarket_pnl: display.use_us_premarket_pnl,
        use_us_postmarket_pnl: display.use_us_postmarket_pnl,
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
      const displaySetting = normalizeDisplaySetting(res.display);
      setDisplay(displaySetting);
      setSession(res.security);
      onDisplayUpdated(displaySetting);
      setFx(await api.fx(displaySetting.settlement_currency));
      await onPortfolioChanged();
      setSaveButton({
        status: "success",
        reason: null,
      });
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
    if (passwordButton.status !== "idle") return;
    setPwdFeedback(null);
    setMessage(null);
    if (!currentPassword) return setPwdFeedback({ ok: false, text: "请输入当前密码", field: "current" });
    if (newPassword.length < 4) {
      setNewPassword("");
      return setPwdFeedback({ ok: false, text: "新密码至少 4 位", field: "new" });
    }
    if (newPassword !== confirmPassword) {
      setConfirmPassword("");
      return setPwdFeedback({ ok: false, text: "两次输入的新密码不一致", field: "confirm" });
    }
    setPasswordButton({ status: "running" });
    try {
      const res = await api.adminChangePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordButton({ status: "success" });
      setPasswordCountdown(5);
      let remaining = 5;
      if (passwordReloginTimer.current != null) window.clearInterval(passwordReloginTimer.current);
      passwordReloginTimer.current = window.setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          if (passwordReloginTimer.current != null) window.clearInterval(passwordReloginTimer.current);
          passwordReloginTimer.current = null;
          setSession(res.security);
          setDisplay(null);
          setPasswordButton({ status: "idle" });
          setPasswordCountdown(null);
          setPwdFeedback(null);
          onLocked();
          return;
        }
        setPasswordCountdown(remaining);
      }, 1000);
    } catch (e) {
      setPasswordButton({ status: "idle" });
      if (e instanceof ApiError && e.status === 401 && e.message === "请先输入后台密码") markLocked();
      else if (e instanceof ApiError && e.status === 401) {
        setCurrentPassword("");
        setPwdFeedback({ ok: false, text: "当前密码错误", field: "current" });
      }
      else setPwdFeedback({ ok: false, text: e instanceof Error ? e.message : "密码修改失败", field: "form" });
    }
  };

  const resetFxButtonLater = () => {
    if (fxResetTimer.current != null) window.clearTimeout(fxResetTimer.current);
    fxResetTimer.current = window.setTimeout(() => {
      setFxButton((state) =>
        state.status === "success" || state.status === "failed"
          ? { status: "idle", reason: null }
          : state,
      );
      fxResetTimer.current = null;
    }, 3000);
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
        resetFxButtonLater();
        return;
      }
      setFxButton({ status: "success", reason: "汇率已刷新" });
      resetFxButtonLater();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) markLocked();
      else {
        setFxButton({ status: "failed", reason: e instanceof Error ? e.message : "汇率刷新失败" });
        resetFxButtonLater();
      }
    }
  };

  const showAllocationFeedback = (feedback: NonNullable<AllocationFeedback>) => {
    if (allocationResetTimer.current != null) window.clearTimeout(allocationResetTimer.current);
    setAllocationFeedback(feedback);
    allocationResetTimer.current = window.setTimeout(() => {
      setAllocationFeedback((state) => (state?.action === feedback.action ? null : state));
      allocationResetTimer.current = null;
    }, 2600);
  };

  const resetAllocationFeedback = (action: AllocationAction) => {
    if (allocationResetTimer.current != null) {
      window.clearTimeout(allocationResetTimer.current);
      allocationResetTimer.current = null;
    }
    setAllocationFeedback((state) => (state?.action === action ? null : state));
  };

  const exportAllocation = async () => {
    setAllocationBusy("export");
    resetAllocationFeedback("export");
    setError(null);
    setMessage(null);
    try {
      const data = await api.exportAllocation();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `trackfolio-allocation-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showAllocationFeedback({ action: "export", ok: true, text: `已导出 ${data.holdings.length} 项` });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) markLocked();
      else showAllocationFeedback({ action: "export", ok: false, text: e instanceof Error ? e.message : "导出失败" });
    } finally {
      setAllocationBusy(null);
    }
  };

  const parseAllocationFile = (raw: unknown): AllocationExportFile => {
    if (!raw || typeof raw !== "object") throw new Error("文件内容不是有效的资产配置 JSON");
    const data = raw as Partial<AllocationExportFile>;
    if (data.schema !== "trackfolio.assetAllocation.v1") throw new Error("资产配置文件版本不支持");
    if (!Array.isArray(data.holdings)) throw new Error("资产配置文件缺少 holdings 列表");
    return data as AllocationExportFile;
  };

  const importAllocation = async (file: File) => {
    setAllocationBusy("import");
    resetAllocationFeedback("import");
    setError(null);
    setMessage(null);
    try {
      const data = parseAllocationFile(JSON.parse(await file.text()));
      const res = await api.importAllocation({ ...data, mode: "skip_existing" });
      onPortfolioChanged();
      const failedRecompute = res.recompute?.filter((r) => r.status === "failed") ?? [];
      const suffix = failedRecompute.length > 0 ? `，${failedRecompute.length} 项历史重算失败` : "";
      showAllocationFeedback({ action: "import", ok: true, text: `导入 ${res.imported}，跳过 ${res.skipped}${suffix}` });
    } catch (e) {
      if (e instanceof SyntaxError) showAllocationFeedback({ action: "import", ok: false, text: "JSON 格式错误" });
      else if (e instanceof ApiError && e.status === 401) markLocked();
      else showAllocationFeedback({ action: "import", ok: false, text: e instanceof Error ? e.message : "导入失败" });
    } finally {
      setAllocationBusy(null);
      if (importInputRef.current) importInputRef.current.value = "";
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
        ? "保存成功"
        : saveButton.status === "failed"
          ? "保存失败"
          : "保存设置";
  const saveButtonClass =
    saveButton.status === "success"
      ? "border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--surface-hover)]"
      : saveButton.status === "failed"
        ? "border border-red-400/40 bg-red-500/10 text-red-300 hover:bg-red-500/15"
        : "";
  const saveFeedback =
    saveButton.status === "failed" ? (saveButton.reason ?? saveButtonText) : null;

  const markLocked = () => {
    setSession({ unlocked: false, unlock_expires_at: null });
    setDisplay(null);
    setShowAdd(false);
    setEditingHolding(null);
    setArchivingHolding(null);
    onLocked();
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

  const passwordError = (field: PasswordFeedbackField) => (pwdFeedback?.field === field && !pwdFeedback.ok ? pwdFeedback.text : null);
  const passwordPlaceholder = (field: PasswordFeedbackField) => passwordError(field) ?? "";
  const passwordInputClass = (field: PasswordFeedbackField) =>
    `${inputCls} ${
      passwordError(field)
        ? "border-red-400/50 placeholder:text-red-400/80 focus:border-red-400/60 focus:shadow-[0_0_0_3px_rgba(248,113,113,0.16)]"
        : ""
    }`;
  const clearPasswordFeedback = (field: PasswordFeedbackField) => {
    setPwdFeedback((state) => (!state || state.ok || state.field === field || state.field === "form" ? null : state));
  };
  const passwordControlsDisabled = passwordButton.status !== "idle";
  const passwordButtonText =
    passwordButton.status === "running"
      ? "更新中..."
      : passwordButton.status === "success"
        ? `更新成功，${passwordCountdown ?? 0}s 后重新登录`
        : "更新密码";
  const passwordButtonClass =
    passwordButton.status === "success"
      ? "border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--surface-hover)]"
      : "text-[var(--text)]";
  const unlockButtonText =
    unlockButton.status === "running"
      ? "验证中..."
      : unlockButton.status === "failed"
        ? unlockButton.reason ?? "解锁失败"
        : "进入后台";
  const unlockButtonClass =
    unlockButton.status === "failed"
      ? "btn-ghost border-red-400/40 bg-red-500/10 text-red-300 hover:bg-red-500/15"
      : "btn-accent";

  return (
    <main className="mx-auto max-w-[1100px] space-y-4 px-3 py-3 pb-8 sm:space-y-5 sm:px-5 sm:py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="label">Admin</div>
          <h1 className="mt-1 text-xl font-semibold text-slate-50">后台设置</h1>
        </div>
      </div>

      {loading ? (
        <GlassLoader heightClass="min-h-[112px]" density="compact" />
      ) : !unlocked ? (
        <form onSubmit={unlock} className="panel mx-auto max-w-md p-4 sm:p-5">
          <h2 className="text-base font-semibold text-slate-50">输入后台密码</h2>
          <div className="mt-4">
            <label className="label">密码</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" className={`${inputCls} mt-1`} autoFocus />
          </div>
          {captcha && (
            <div className="mt-4">
              <label className="label">验证码</label>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={() => void refreshCaptcha()}
                  title="看不清？点击换一张"
                  className="w-full select-none overflow-hidden rounded-md border border-white/[0.08] bg-white/[0.03] p-1 transition-colors hover:border-[var(--accent-line)] sm:w-auto"
                >
                  <img src={captcha.image} alt="验证码" className="h-[42px] w-[150px] object-contain" draggable={false} />
                </button>
                <input
                  value={captchaInput}
                  onChange={(e) => setCaptchaInput(e.target.value)}
                  inputMode="text"
                  autoCapitalize="characters"
                  autoComplete="off"
                  placeholder="请输入图中字符"
                  className={`${inputCls} flex-1`}
                />
              </div>
            </div>
          )}
          {error && <div className="mt-3 rounded bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>}
          {message && <div className="mt-3 rounded bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{message}</div>}
          <button
            className={`${unlockButtonClass} mt-4 w-full py-2 text-sm disabled:opacity-60`}
            type="submit"
            disabled={unlockButton.status === "running"}
            aria-live="polite"
          >
            {unlockButtonText}
          </button>
        </form>
      ) : (
        <div className="grid gap-4 sm:gap-5 lg:grid-cols-[1.4fr_1fr]">
          <section className="panel p-4 sm:p-5 lg:col-span-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="label">Assets</div>
                <h2 className="mt-1 text-base font-semibold text-slate-50">资产配置</h2>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                <button
                  type="button"
                  disabled={validating}
                  onClick={() => void validate()}
                  data-tooltip={validateButton.status === "failed" ? validateButtonTitle : undefined}
                  className={`tf-tooltip btn-ghost min-w-0 px-3 py-2 text-xs disabled:opacity-50 sm:min-w-[72px] sm:py-1.5 ${validateButtonClass}`}
                >
                  {validateButtonText}
                </button>
                <button
                  type="button"
                  disabled={allocationBusy !== null}
                  onClick={() => void exportAllocation()}
                  data-state={allocationBusy === "export" ? "running" : allocationFeedback?.action === "export" ? (allocationFeedback.ok ? "success" : "failed") : "idle"}
                  className="allocation-action btn-ghost min-w-0 px-3 py-2 text-xs text-slate-200 disabled:opacity-50 sm:min-w-[82px] sm:py-1.5"
                >
                  {allocationBusy === "export"
                    ? "导出中..."
                    : allocationFeedback?.action === "export"
                      ? allocationFeedback.text
                      : "导出资产"}
                </button>
                <label
                  data-state={allocationBusy === "import" ? "running" : allocationFeedback?.action === "import" ? (allocationFeedback.ok ? "success" : "failed") : "idle"}
                  className={`allocation-action btn-ghost min-w-0 cursor-pointer px-3 py-2 text-center text-xs text-slate-200 sm:min-w-[82px] sm:py-1.5 ${allocationBusy !== null ? "pointer-events-none opacity-50" : ""}`}
                >
                  {allocationBusy === "import"
                    ? "导入中..."
                    : allocationFeedback?.action === "import"
                      ? allocationFeedback.text
                      : "导入资产"}
                  <input
                    ref={importInputRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    disabled={allocationBusy !== null}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void importAllocation(file);
                      else e.currentTarget.value = "";
                    }}
                  />
                </label>
                <button type="button" disabled={!meta} onClick={() => setShowAdd(true)} className="btn-accent px-3.5 py-2 text-xs disabled:opacity-50 sm:py-1.5">+ 添加资产</button>
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-500">当前持仓如下。可导出活跃持仓配置为 JSON；导入会按配置创建资产并生成买入交易，不是完整交易流水或定投计划备份。点「校验」会重新拉取行情与历史价格并重算盈亏。</p>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1 md:hidden">
              {ADMIN_MOBILE_SORT_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => toggleSort(option.key)}
                  className={`btn-ghost shrink-0 px-3 py-1.5 text-xs ${
                    sortKey === option.key ? "border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]" : "text-slate-300"
                  }`}
                >
                  {option.label}{sortArrow(option.key)}
                </button>
              ))}
            </div>
            <div className="mt-4 overflow-hidden rounded-xl border border-white/[0.06]">
              <div className="divide-y divide-white/[0.06] md:hidden">
                {pageHoldings.map((h, i) => (
                  <AdminHoldingCard
                    key={h.position.id}
                    holding={h}
                    settlementCurrency={settlementCurrency}
                    index={i}
                    onEdit={() => setEditingHolding(h)}
                    onArchive={() => setArchivingHolding(h)}
                  />
                ))}
                {holdings.length === 0 && (
                  <div className="px-3 py-10 text-center text-sm text-slate-600">暂无持仓，点击上方添加资产。</div>
                )}
              </div>
              <div className="hidden overflow-auto md:block" style={{ height: listHeight ?? undefined }}>
                <table className="w-full min-w-[860px] text-sm">
                  <thead ref={headRef} className="sticky top-0 z-10 bg-[var(--surface-2)] text-left text-[10px] uppercase tracking-[0.08em] text-slate-500 backdrop-blur-xl">
                    <tr>
                      <th className="px-3 py-2 font-medium">资产</th>
                      <th className="cursor-pointer select-none px-3 py-2 text-right font-medium hover:text-slate-300" onClick={() => toggleSort("quantity")}>持仓{sortArrow("quantity")}</th>
                      <th className="cursor-pointer select-none px-3 py-2 text-right font-medium hover:text-slate-300" onClick={() => toggleSort("unit_cost")}>成本(含费){sortArrow("unit_cost")}</th>
                      <th className="cursor-pointer select-none px-3 py-2 text-right font-medium hover:text-slate-300" onClick={() => toggleSort("latest")}>最新价{sortArrow("latest")}</th>
                      <th className="cursor-pointer select-none px-3 py-2 text-right font-medium hover:text-slate-300" onClick={() => toggleSort("market_value")}>市值{sortArrow("market_value")}</th>
                      <th className="cursor-pointer select-none px-3 py-2 text-right font-medium hover:text-slate-300" onClick={() => toggleSort("total_pnl")}>总盈亏{sortArrow("total_pnl")}</th>
                      <th className="px-3 py-2 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody ref={bodyRef}>
                    {pageHoldings.map((h, i) => (
                      <tr
                        key={h.position.id}
                        className="data-row border-t border-white/[0.04]"
                        style={{ animationDelay: `${Math.min(i * 16, 120)}ms` }}
                      >
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
            <form onSubmit={saveDisplay} className="panel p-4 sm:p-5 lg:col-span-2">
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
                <Field label="结算时区">
                  <ThemedSelect
                    value={display.settlement_timezone}
                    options={timezoneOptionsFor(display.settlement_timezone)}
                    onChange={(v) => updateDisplayDraft({ ...display, settlement_timezone: v })}
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
                  <input type="checkbox" checked={display.use_us_premarket_pnl} onChange={(e) => updateDisplayDraft({ ...display, use_us_premarket_pnl: e.target.checked })} />
                  美股盘前行情
                </label>
                <label className="flex items-center gap-2 pt-6 text-sm text-slate-300">
                  <input type="checkbox" checked={display.use_us_postmarket_pnl} onChange={(e) => updateDisplayDraft({ ...display, use_us_postmarket_pnl: e.target.checked })} />
                  美股盘后行情
                </label>
                <label className="flex items-center gap-2 pt-6 text-sm text-slate-300">
                  <input type="checkbox" checked={display.show_original_currency} onChange={(e) => updateDisplayDraft({ ...display, show_original_currency: e.target.checked })} />
                  显示原币金额
                </label>
              </div>
              {fx && (
                  <div className="mt-5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs text-slate-500">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <span className="min-w-0 leading-5">
                      汇率来源：<span className="text-slate-300">{fxProviderLabel(fx.provider_setting)}</span>
                      {fx.source && fx.source !== fx.provider_setting && (
                        <> · 当前数据：<span className="text-slate-300">{fxProviderLabel(fx.source)}</span></>
                      )}
                      {" "}· 更新时间：<span className="tnum text-slate-300">{fx.last_update ?? "—"}</span>{fx.stale && <span className="ml-2 text-amber-300">可能已过期</span>}
                    </span>
                    <span className="flex w-full items-center gap-2 sm:w-auto">
                      <button
                        type="button"
                        disabled={fxButton.status === "running"}
                        data-tooltip={fxButton.status === "failed" ? fxButtonTitle : undefined}
                        onClick={() => void refreshFx()}
                        className={`tf-tooltip btn-ghost w-full min-w-[82px] px-2.5 py-2 text-xs disabled:opacity-50 sm:w-auto sm:py-1 ${fxButtonClass}`}
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
              <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
                <button
                  disabled={saveButton.status === "running"}
                  className={`${saveButton.status === "success" || saveButton.status === "failed" ? "btn-ghost" : "btn-accent"} inline-flex h-10 w-full items-center justify-center whitespace-nowrap px-5 text-sm disabled:opacity-50 sm:h-9 sm:w-auto sm:min-w-[128px] ${saveButtonClass}`}
                  type="submit"
                >
                  {saveButtonText}
                </button>
                {saveFeedback && (
                  <span className={`content-reveal text-xs ${saveButton.status === "success" ? "text-[var(--accent)]" : "text-red-400"}`}>
                    {saveFeedback}
                  </span>
                )}
              </div>
            </form>
          )}

          <form onSubmit={changePassword} className="panel p-4 sm:p-5 lg:col-span-2">
            <div className="label">Password</div>
            <h2 className="mt-1 text-base font-semibold text-slate-50">修改后台密码</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <Field label="当前密码">
                <input
                  type="password"
                  value={currentPassword}
                  disabled={passwordControlsDisabled}
                  onChange={(e) => {
                    setCurrentPassword(e.target.value);
                    clearPasswordFeedback("current");
                  }}
                  placeholder={passwordPlaceholder("current")}
                  aria-invalid={!!passwordError("current")}
                  className={passwordInputClass("current")}
                />
              </Field>
              <Field label="新密码">
                <input
                  type="password"
                  value={newPassword}
                  disabled={passwordControlsDisabled}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    clearPasswordFeedback("new");
                  }}
                  placeholder={passwordPlaceholder("new")}
                  aria-invalid={!!passwordError("new")}
                  className={passwordInputClass("new")}
                />
              </Field>
              <Field label="确认新密码">
                <input
                  type="password"
                  value={confirmPassword}
                  disabled={passwordControlsDisabled}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    clearPasswordFeedback("confirm");
                  }}
                  placeholder={passwordPlaceholder("confirm")}
                  aria-invalid={!!passwordError("confirm")}
                  className={passwordInputClass("confirm")}
                />
              </Field>
            </div>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                className={`btn-ghost w-full px-5 py-2.5 text-sm disabled:cursor-default disabled:opacity-100 sm:w-auto sm:py-2 ${passwordButtonClass}`}
                type="submit"
                disabled={passwordControlsDisabled}
                aria-live="polite"
              >
                {passwordButtonText}
              </button>
              {pwdFeedback?.field === "form" && (
                <span className={`text-xs ${pwdFeedback.ok ? "text-[var(--accent)]" : "text-red-400"}`}>
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
            setMessage("已清仓归档，历史记录已保留");
          }}
          onLocked={markLocked}
        />
      )}
    </main>
  );
}

function AdminHoldingCard({
  holding,
  settlementCurrency,
  index,
  onEdit,
  onArchive,
}: {
  holding: Holding;
  settlementCurrency: Currency;
  index: number;
  onEdit: () => void;
  onArchive: () => void;
}) {
  return (
    <article className="data-row p-3" style={{ animationDelay: `${Math.min(index * 16, 120)}ms` }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-100">{holding.asset.name || holding.asset.symbol}</div>
          <div className="tnum mt-0.5 text-xs text-slate-500">
            {holding.asset.symbol} · {holding.asset.asset_type === "FUND" ? "基金" : "股票"}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="label">总盈亏</div>
          <div className={`tnum mt-1 text-sm font-semibold ${pnlColor(holding.total_pnl_settled)}`}>
            {fmtMoney(holding.total_pnl_settled, settlementCurrency)}
          </div>
          <div className={`tnum text-xs ${pnlColor(holding.total_pnl_settled)}`}>{fmtPercent(holding.total_pnl.percent)}</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <AdminMobileMetric label="持仓">{fmtQty(holding.position.quantity)}</AdminMobileMetric>
        <AdminMobileMetric label="成本(含费)">{fmtNum(unitCostWithFee(holding.position), 2)}</AdminMobileMetric>
        <AdminMobileMetric label="最新价">{fmtNum(holding.latest, holding.is_nav_based ? 4 : 2)}</AdminMobileMetric>
        <AdminMobileMetric label="市值">{fmtMoney(holding.market_value_settled, settlementCurrency)}</AdminMobileMetric>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={onEdit} className="btn-ghost px-3 py-2 text-xs text-slate-200">
          编辑交易
        </button>
        <button type="button" onClick={onArchive} className="rounded-md border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 hover:bg-amber-500/15">
          清仓归档
        </button>
      </div>
    </article>
  );
}

function AdminMobileMetric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
      <div className="label">{label}</div>
      <div className="tnum mt-1 truncate text-sm text-slate-200">{children}</div>
    </div>
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
  const { isExiting, requestClose } = useExitTransition(onClose);

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
      requestClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onLocked();
      else setError(e instanceof Error ? e.message : "清仓归档失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="motion-modal-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto modal-backdrop p-3 pt-8 backdrop-blur-md sm:p-4 sm:pt-16"
      data-closing={isExiting || undefined}
      onClick={requestClose}
    >
      <form
        onSubmit={submit}
        className="motion-modal-panel panel w-full max-w-md p-4 sm:p-5"
        data-closing={isExiting || undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="label">Archive</div>
            <h2 className="text-base font-semibold text-slate-50">清仓归档</h2>
          </div>
          <button type="button" onClick={requestClose} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-slate-200">✕</button>
        </div>
        <p className="text-sm leading-6 text-slate-500">
          将按剩余持仓数量新增一笔卖出交易，资产和历史记录不会删除；清仓后首页不再显示该持仓。
        </p>
        <div className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-sm">
          <div className="font-medium text-slate-100">{holding.asset.name || holding.asset.symbol}</div>
          <div className="tnum mt-1 text-xs text-slate-500">{holding.asset.symbol} · 剩余 {fmtQty(holding.position.quantity)}</div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="清仓价格"><input value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} inputMode="decimal" autoFocus /></Field>
          <Field label="交易费用"><input value={fee} onChange={(e) => setFee(e.target.value)} className={inputCls} inputMode="decimal" /></Field>
          <Field label="清仓日期"><DateField value={tradeTime} onChange={setTradeTime} className={inputCls} /></Field>
          <Field label="备注"><input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} /></Field>
        </div>
        {error && <div className="content-reveal mt-3 rounded bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={requestClose} className="btn-ghost px-4 py-2 text-sm text-slate-300">取消</button>
          <button disabled={submitting} type="submit" className="btn-accent px-4 py-2 text-sm disabled:opacity-50">确认清仓归档</button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children, error }: { label: string; children: React.ReactNode; error?: string | null }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-1">{children}</div>
      {error && <div className="content-reveal mt-1 text-xs text-red-400">{error}</div>}
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
    <div className="flex min-w-0 items-center gap-2 sm:min-w-[220px]">
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
