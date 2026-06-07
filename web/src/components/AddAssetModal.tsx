import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api";
import type { Asset, AssetType, Currency, Market, Meta, SearchResult } from "../types";
import { MARKET_LABEL } from "../lib/format";
import { DateField } from "./DateField";

interface Props {
  meta: Meta;
  onClose: () => void;
  onCreated: () => void;
  onLocked?: () => void;
}

export function AddAssetModal({ meta, onClose, onCreated, onLocked }: Props) {
  // 标的身份（搜索选中或手动录入后填充，提交时使用）
  const [assetType, setAssetType] = useState<AssetType>("STOCK");
  const [market, setMarket] = useState<Market>("CN");
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<Currency>(meta.default_currency.CN);
  const [fundType, setFundType] = useState<"etf" | "otc">("etf");

  // 选标的方式：搜索选中 picked / 手动录入 manual
  const [picked, setPicked] = useState<SearchResult | null>(null);
  const [manual, setManual] = useState(false);
  const [allowCustom, setAllowCustom] = useState(false);

  // 建仓方式：单笔 single / 批量定投 sip
  const [mode, setMode] = useState<"single" | "sip">("single");

  // 交易（建仓）字段
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("0");
  const [openedAt, setOpenedAt] = useState("");
  const [tags, setTags] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasIdentity = picked !== null || manual;
  // 仅场外基金（按净值、非实时）支持定投补录
  const isOtcFund = assetType === "FUND" && fundType === "otc";

  // 标的切换为非场外基金时，强制回到单笔建仓
  useEffect(() => {
    if (mode === "sip" && !isOtcFund) setMode("single");
  }, [mode, isOtcFund]);

  const applyResult = (r: SearchResult) => {
    setPicked(r);
    setAssetType(r.asset_type);
    setMarket(r.market);
    setSymbol(r.symbol);
    setName(r.name);
    setCurrency(r.currency);
    if (r.asset_type === "FUND") setFundType(r.fund_type === "otc" ? "otc" : "etf");
    setError(null);
  };

  const startManual = () => {
    setManual(true);
    setPicked(null);
    setSymbol("");
    setName("");
  };

  const resetIdentity = () => {
    setPicked(null);
    setManual(false);
    setSymbol("");
    setName("");
  };

  const onMarketChange = (m: Market) => {
    setMarket(m);
    setCurrency(meta.default_currency[m]);
  };

  // 创建标的；已存在则复用（加仓 / 定投补录均按已有资产处理，成本自动重算）
  const ensureAsset = async (): Promise<Asset> => {
    try {
      return await api.createAsset({
        asset_type: assetType,
        market,
        symbol: symbol.trim().toUpperCase(),
        name: name.trim(),
        currency,
        fund_type: assetType === "FUND" ? fundType : null,
        allow_custom: allowCustom,
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) return (e.detail as { asset: Asset }).asset;
      throw e;
    }
  };

  const submit = async () => {
    setError(null);
    const qty = Number(quantity);
    const px = Number(price);
    if (!symbol.trim() || !name.trim()) return setError("请先搜索选择或手动录入标的");
    if (!Number.isFinite(qty) || qty <= 0) return setError("请填写有效的买入数量");
    if (!Number.isFinite(px) || px < 0) return setError("请填写有效的买入价");

    setSubmitting(true);
    try {
      const asset = await ensureAsset();

      await api.createTransaction(asset.id, {
        side: "BUY",
        quantity: qty,
        price: px,
        fee: Number(fee) || 0,
        trade_time: openedAt || null,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      onCreated();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && onLocked) onLocked();
      else setError(e instanceof Error ? e.message : "添加失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/[0.08] p-4 pt-16 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        className={`panel modal-panel fade-in w-full ${hasIdentity && mode === "sip" ? "max-w-2xl" : "max-w-lg"} p-5`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-50">
            <span className="h-4 w-1 rounded-full bg-[var(--accent)]" />
            添加资产 / 建仓
          </h2>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        {/* 标的选择：搜索 / 已选 / 手动 */}
        {!hasIdentity && <SearchBox onPick={applyResult} onManual={startManual} />}

        {picked && <SelectedCard result={picked} onChange={resetIdentity} />}

        {manual && (
          <ManualIdentity
            meta={meta}
            assetType={assetType}
            setAssetType={setAssetType}
            market={market}
            onMarketChange={onMarketChange}
            fundType={fundType}
            setFundType={setFundType}
            currency={currency}
            setCurrency={setCurrency}
            symbol={symbol}
            setSymbol={setSymbol}
            name={name}
            setName={setName}
            allowCustom={allowCustom}
            setAllowCustom={setAllowCustom}
            onBack={resetIdentity}
          />
        )}

        {/* 建仓方式切换 —— 仅场外基金支持定投补录 */}
        {hasIdentity && isOtcFund && (
          <div className="mt-4">
            <Seg
              options={[
                ["single", "单笔建仓"],
                ["sip", "批量定投"],
              ]}
              value={mode}
              onChange={(v) => setMode(v as "single" | "sip")}
            />
          </div>
        )}

        {/* 单笔建仓字段 */}
        {hasIdentity && mode === "single" && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Field label="买入数量 / 份额">
                <input value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="decimal" className={inputCls} autoFocus />
              </Field>
              <Field label="买入价">
                <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className={inputCls} />
              </Field>
              <Field label="交易费用">
                <input value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal" className={inputCls} />
              </Field>
              <Field label="买入日期">
                <DateField value={openedAt} onChange={setOpenedAt} className={inputCls} />
              </Field>
              <Field label="标签（逗号分隔）" full>
                <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="核心仓, 长期" className={inputCls} />
              </Field>
            </div>

            <p className="mt-2 text-xs text-slate-500">
              录入买入价后，持仓的<span className="text-slate-300">平均成本由系统按加权平均自动计算</span>；
              再次添加同一标的将作为加仓，成本自动重算。
            </p>
          </>
        )}

        {/* 批量定投：自带生成预览与保存按钮 */}
        {hasIdentity && mode === "sip" && (
          <SipPanel symbol={symbol} ensureAsset={ensureAsset} onCreated={onCreated} onClose={onClose} onLocked={onLocked} />
        )}

        {error && <div className="mt-3 rounded bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>}

        {mode === "single" && (
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={onClose} className="btn-ghost px-3.5 py-1.5 text-sm text-slate-300">
              取消
            </button>
            <button
              onClick={submit}
              disabled={submitting || !hasIdentity}
              className="btn-accent px-5 py-1.5 text-sm disabled:opacity-50"
            >
              {submitting ? "保存中…" : "保存"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** 搜索框 + 结果下拉（代码 / 名称 / 拼音） */
function SearchBox({
  onPick,
  onManual,
}: {
  onPick: (r: SearchResult) => void;
  onManual: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const id = ++reqId.current;
    const timer = setTimeout(() => {
      api
        .search(query)
        .then((res) => {
          if (id === reqId.current) setResults(res);
        })
        .catch(() => {
          if (id === reqId.current) setResults([]);
        })
        .finally(() => {
          if (id === reqId.current) setSearching(false);
        });
    }, 220);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <div>
      <label className="mb-1 block text-xs text-slate-400">搜索股票 / 基金</label>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="输入代码、名称或拼音，如 600519 / 茅台 / gzmt / AAPL"
        className={inputCls}
        autoFocus
      />

      {q.trim() && (
        <div className="menu-pop mt-2 max-h-64 overflow-y-auto rounded-lg border border-white/[0.08] bg-black/30">
          {searching && results.length === 0 && (
            <div className="px-3 py-3 text-xs text-slate-500">搜索中…</div>
          )}
          {!searching && results.length === 0 && (
            <div className="px-3 py-3 text-xs text-slate-500">没有匹配的标的，可手动录入</div>
          )}
          {results.map((r) => (
            <button
              key={`${r.asset_type}:${r.market}:${r.symbol}`}
              onClick={() => onPick(r)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-white/[0.05]"
            >
              <span className="chip text-slate-400">{MARKET_LABEL[r.market]}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-slate-100">{r.name}</span>
                <span className="tnum text-xs text-slate-500">
                  {r.symbol} · {r.asset_type === "FUND" ? (r.fund_type === "otc" ? "场外基金" : "场内基金") : "股票"}
                </span>
              </span>
              <span className="text-xs text-slate-600">{r.currency}</span>
            </button>
          ))}
        </div>
      )}

      <button onClick={onManual} className="mt-2 text-xs text-slate-500 hover:text-[var(--accent)]">
        找不到？手动录入自定义标的 →
      </button>
    </div>
  );
}

/** 已选标的摘要卡 */
function SelectedCard({ result, onChange }: { result: SearchResult; onChange: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[var(--accent-line)] bg-[var(--accent-soft)] px-3 py-2.5">
      <span className="chip text-slate-300">{MARKET_LABEL[result.market]}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-50">{result.name}</span>
        <span className="tnum text-xs text-slate-400">
          {result.symbol} · {result.asset_type === "FUND" ? (result.fund_type === "otc" ? "场外基金" : "场内基金") : "股票"} · {result.currency}
        </span>
      </span>
      <button onClick={onChange} className="btn-ghost px-2.5 py-1 text-xs text-slate-300">
        更换
      </button>
    </div>
  );
}

/** 手动录入标的身份（自定义/未收录标的） */
function ManualIdentity(props: {
  meta: Meta;
  assetType: AssetType;
  setAssetType: (v: AssetType) => void;
  market: Market;
  onMarketChange: (m: Market) => void;
  fundType: "etf" | "otc";
  setFundType: (v: "etf" | "otc") => void;
  currency: Currency;
  setCurrency: (v: Currency) => void;
  symbol: string;
  setSymbol: (v: string) => void;
  name: string;
  setName: (v: string) => void;
  allowCustom: boolean;
  setAllowCustom: (v: boolean) => void;
  onBack: () => void;
}) {
  const { meta } = props;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="label">手动录入标的</span>
        <button onClick={props.onBack} className="text-xs text-slate-500 hover:text-[var(--accent)]">
          ← 返回搜索
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="资产类型">
          <Seg
            options={[
              ["STOCK", "股票"],
              ["FUND", "基金"],
            ]}
            value={props.assetType}
            onChange={(v) => props.setAssetType(v as AssetType)}
          />
        </Field>
        <Field label="市场">
          <Seg
            options={meta.markets.map((m) => [m, MARKET_LABEL[m]] as [string, string])}
            value={props.market}
            onChange={(v) => props.onMarketChange(v as Market)}
          />
        </Field>

        {props.assetType === "FUND" && (
          <Field label="基金类型">
            <Seg
              options={[
                ["etf", "场内/ETF"],
                ["otc", "场外(净值)"],
              ]}
              value={props.fundType}
              onChange={(v) => props.setFundType(v as "etf" | "otc")}
            />
          </Field>
        )}
        <Field label="币种">
          <select value={props.currency} onChange={(e) => props.setCurrency(e.target.value as Currency)} className={inputCls}>
            {meta.currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>

        <Field label="代码">
          <input
            value={props.symbol}
            onChange={(e) => props.setSymbol(e.target.value)}
            placeholder={props.market === "US" ? "AAPL" : "600519"}
            className={inputCls}
          />
        </Field>
        <Field label="名称">
          <input value={props.name} onChange={(e) => props.setName(e.target.value)} placeholder="贵州茅台" className={inputCls} />
        </Field>
      </div>

      <label className="mt-3 flex items-center gap-2 text-xs text-slate-400">
        <input type="checkbox" checked={props.allowCustom} onChange={(e) => props.setAllowCustom(e.target.checked)} />
        代码不符合标准格式时，仍保存为自定义标的（标记为数据不可用）
      </label>
    </div>
  );
}

const inputCls = "input-base";

/** 批量定投补录：按频率 + 区间生成多期，逐期补价格后一次性建仓 */
type Freq = "daily" | "weekly" | "biweekly" | "monthly";
interface SipRow {
  date: string;
  price: string;
  per: string; // 每期金额（定额）或份额（定量）
  fee: string;
}

function SipPanel({
  symbol,
  ensureAsset,
  onCreated,
  onClose,
  onLocked,
}: {
  symbol: string;
  ensureAsset: () => Promise<Asset>;
  onCreated: () => void;
  onClose: () => void;
  onLocked?: () => void;
}) {
  const [freq, setFreq] = useState<Freq>("monthly");
  const [sipMode, setSipMode] = useState<"amount" | "shares">("amount");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState(todayStr());
  const [longTerm, setLongTerm] = useState(false); // 长期：不指定结束日，补录到今天
  const [perValue, setPerValue] = useState("");
  const [feePer, setFeePer] = useState("0");
  const [tags, setTags] = useState("");

  const [rows, setRows] = useState<SipRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [filling, setFilling] = useState(false);
  const [fillNote, setFillNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 每行按方式推算 数量 / 金额
  const calc = (r: SipRow): { qty: number; amount: number } => {
    const price = Number(r.price);
    const per = Number(r.per);
    if (sipMode === "amount") return { qty: price > 0 ? per / price : NaN, amount: per };
    return { qty: per, amount: per * price };
  };
  const rowValid = (r: SipRow): boolean => {
    const price = Number(r.price);
    const { qty } = calc(r);
    return Number.isFinite(price) && price > 0 && Number.isFinite(qty) && qty > 0;
  };

  // 生成定投日序列并自动回填历史净值（非交易日取下一交易日净值）
  const generate = async () => {
    setError(null);
    setFillNote(null);
    if (!start) return setError("请填写起始日期");
    const effectiveEnd = longTerm ? todayStr() : end;
    if (!effectiveEnd) return setError("请填写结束日期，或勾选长期");
    const dates = genSchedule(start, effectiveEnd, freq);
    if (dates.length === 0) return setError("日期区间无效，结束日期需不早于起始日期");

    const rawRows = (ds: string[]): SipRow[] => ds.map((date) => ({ date, price: "", per: perValue, fee: feePer }));
    setRows(rawRows(dates));

    setFilling(true);
    try {
      const { points } = await api.fundNavHistory(symbol.trim(), dates[0], dates[dates.length - 1]);
      if (points.length === 0) {
        setFillNote("未取到历史净值（新基金或数据源不可用），请手动补录价格与交易日");
        return;
      }
      // 定投日若落在非交易日（周末/节假日），顺延到下一交易日（净值披露日）按当日净值成交；按交易日去重
      const seen = new Set<string>();
      const built: SipRow[] = [];
      let missing = 0;
      let shifted = 0;
      for (const date of dates) {
        const m = matchNav(points, date);
        if (!m) {
          if (!seen.has(date)) {
            seen.add(date);
            built.push({ date, price: "", per: perValue, fee: feePer });
          }
          missing++;
          continue;
        }
        if (seen.has(m.date)) continue; // 多个计划日顺延到同一交易日（如每日定投遇周末）
        seen.add(m.date);
        if (m.date !== date) shifted++;
        built.push({ date: m.date, price: String(m.close), per: perValue, fee: feePer });
      }
      setRows(built);
      setFillNote(
        `已生成 ${built.length} 期${shifted ? `，${shifted} 期非交易日已顺延至下一交易日` : ""}${
          missing ? `，${missing} 期暂无净值需手动补` : ""
        }`,
      );
    } catch {
      setFillNote("历史净值拉取失败，请手动补录价格");
    } finally {
      setFilling(false);
    }
  };

  const setRow = (i: number, patch: Partial<SipRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));

  const validCount = rows.filter(rowValid).length;
  const totals = rows.filter(rowValid).reduce(
    (acc, r) => {
      const c = calc(r);
      return { amount: acc.amount + c.amount, qty: acc.qty + c.qty };
    },
    { amount: 0, qty: 0 },
  );

  const submit = async () => {
    setError(null);
    if (rows.length === 0) return setError("请先生成定投计划");
    if (validCount !== rows.length)
      return setError(sipMode === "amount" ? "每期都需填写大于 0 的价格" : "每期都需填写有效的价格与份额");

    setSubmitting(true);
    try {
      const asset = await ensureAsset();
      await api.createTransactionsBatch(asset.id, {
        transactions: rows.map((r) => ({
          quantity: calc(r).qty,
          price: Number(r.price),
          fee: Number(r.fee) || 0,
          trade_time: r.date,
          note: "定投",
        })),
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      });
      onCreated();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && onLocked) onLocked();
      else setError(e instanceof Error ? e.message : "批量录入失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
        <Field label="定投频率">
          <Seg
            options={[
              ["daily", "每日"],
              ["weekly", "每周"],
              ["biweekly", "每两周"],
              ["monthly", "每月"],
            ]}
            value={freq}
            onChange={(v) => setFreq(v as Freq)}
          />
        </Field>
        <Field label="每期方式">
          <Seg
            options={[
              ["amount", "按金额"],
              ["shares", "按份额"],
            ]}
            value={sipMode}
            onChange={(v) => setSipMode(v as "amount" | "shares")}
          />
        </Field>
        <Field label="起始日期（首个定投日）">
          <DateField value={start} onChange={setStart} className={inputCls} />
        </Field>
        <Field label="结束日期">
          <div className="flex items-center gap-2">
            <DateField
              value={longTerm ? "" : end}
              onChange={setEnd}
              disabled={longTerm}
              placeholder={longTerm ? "至今" : "选择日期"}
              className={inputCls}
            />
            <label className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-slate-400">
              <input type="checkbox" checked={longTerm} onChange={(e) => setLongTerm(e.target.checked)} />
              长期
            </label>
          </div>
        </Field>
        <Field label={sipMode === "amount" ? "每期金额" : "每期份额"}>
          <input value={perValue} onChange={(e) => setPerValue(e.target.value)} inputMode="decimal" className={inputCls} />
        </Field>
        <Field label="每期费用">
          <input value={feePer} onChange={(e) => setFeePer(e.target.value)} inputMode="decimal" className={inputCls} />
        </Field>
        <Field label="标签（逗号分隔）" full>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="定投, 长期" className={inputCls} />
        </Field>
        <div className="col-span-2 flex items-center gap-3">
          <button
            onClick={generate}
            disabled={filling}
            className="btn-ghost px-3.5 py-1.5 text-sm text-slate-200 disabled:opacity-50"
          >
            {filling ? "生成中…" : "生成预览"}
          </button>
          <span className="text-xs text-slate-500">起始日按所选频率推算到结束日，并自动回填历史净值。</span>
        </div>
      </div>

      {rows.length > 0 && (
        <>
          {fillNote && <div className="mt-3 text-xs text-slate-500">{fillNote}</div>}

          <div className="mt-2 overflow-x-auto rounded-xl border border-white/[0.06]">
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full min-w-[600px] text-sm">
                <thead className="bg-white/[0.02] text-left text-[10px] uppercase tracking-[0.08em] text-slate-500">
                  <tr>
                    <th className="px-2 py-2 font-medium">#</th>
                    <th className="px-2 py-2 font-medium">日期</th>
                    <th className="px-2 py-2 font-medium">价格 / 净值</th>
                    <th className="px-2 py-2 font-medium">{sipMode === "amount" ? "金额" : "份额"}</th>
                    <th className="px-2 py-2 text-right font-medium">{sipMode === "amount" ? "份额" : "金额"}</th>
                    <th className="px-2 py-2 font-medium">费用</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const c = calc(r);
                    const bad = !rowValid(r);
                    return (
                      <tr key={i} className={`border-t border-white/[0.04] ${bad ? "bg-rose-500/[0.06]" : ""}`}>
                        <td className="px-2 py-1.5 text-slate-500">{i + 1}</td>
                        <td className="px-2 py-1.5">
                          <DateField value={r.date} onChange={(v) => setRow(i, { date: v })} className={inputCls} />
                        </td>
                        <td className="px-2 py-1.5">
                          <input value={r.price} onChange={(e) => setRow(i, { price: e.target.value })} inputMode="decimal" className={inputCls} />
                        </td>
                        <td className="px-2 py-1.5">
                          <input value={r.per} onChange={(e) => setRow(i, { per: e.target.value })} inputMode="decimal" className={inputCls} />
                        </td>
                        <td className="tnum px-2 py-1.5 text-right text-slate-400">
                          {sipMode === "amount" ? fmtN(c.qty, 4) : fmtN(c.amount, 2)}
                        </td>
                        <td className="px-2 py-1.5">
                          <input value={r.fee} onChange={(e) => setRow(i, { fee: e.target.value })} inputMode="decimal" className={inputCls} />
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <button onClick={() => removeRow(i)} className="rounded-md px-1.5 py-0.5 text-xs text-rose-400 hover:bg-rose-500/10">
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-2 text-xs text-slate-500">
            共 <span className="text-slate-300">{rows.length}</span> 期 · 有效{" "}
            <span className={validCount === rows.length ? "text-slate-300" : "text-rose-400"}>{validCount}</span> 期 · 合计投入{" "}
            <span className="tnum text-slate-300">{fmtN(totals.amount, 2)}</span> · 合计份额{" "}
            <span className="tnum text-slate-300">{fmtN(totals.qty, 4)}</span>
          </div>
        </>
      )}

      {error && <div className="mt-3 rounded bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>}

      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="btn-ghost px-3.5 py-1.5 text-sm text-slate-300">
          取消
        </button>
        <button
          onClick={submit}
          disabled={submitting || rows.length === 0}
          className="btn-accent px-5 py-1.5 text-sm disabled:opacity-50"
        >
          {submitting ? "保存中…" : rows.length ? `保存 ${rows.length} 期` : "保存"}
        </button>
      </div>
    </div>
  );
}

/**
 * 在升序净值序列中匹配某计划日的成交交易日：取该日或之后最近的交易日净值（定投按下一开放日确认）。
 * 若最近的净值距该日超过 10 天（如基金成立前 / 数据缺口），视为该期无数据，返回 null 不强行回填。
 */
function matchNav(
  points: { date: string; close: number }[],
  date: string,
): { date: string; close: number } | null {
  for (const p of points) {
    if (p.date >= date) {
      const gap = (Date.parse(p.date) - Date.parse(date)) / 86_400_000;
      return gap <= 10 ? p : null;
    }
  }
  return null;
}

function fmtN(n: number, d: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: d });
}

function todayStr(): string {
  return fmtDate(new Date());
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseLocalDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 由起始日按频率推算定投日序列，上限 500 期 */
function genSchedule(start: string, end: string, freq: Freq): string[] {
  const s = parseLocalDate(start);
  const e = parseLocalDate(end);
  if (!s || !e || e < s) return [];
  const out: string[] = [];
  if (freq === "monthly") {
    const day = s.getDate();
    for (let i = 0; out.length < 500; i++) {
      const dt = new Date(s.getFullYear(), s.getMonth() + i, 1);
      const lastDay = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
      dt.setDate(Math.min(day, lastDay));
      if (dt > e) break;
      out.push(fmtDate(dt));
    }
  } else {
    const step = freq === "daily" ? 1 : freq === "weekly" ? 7 : 14;
    const dt = new Date(s.getFullYear(), s.getMonth(), s.getDate());
    while (dt <= e && out.length < 500) {
      out.push(fmtDate(dt));
      dt.setDate(dt.getDate() + step);
    }
  }
  return out;
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <label className="mb-1 block text-xs text-slate-400">{label}</label>
      {children}
    </div>
  );
}

function Seg({
  options,
  value,
  onChange,
}: {
  options: Array<[string, string]>;
  value: string;
  onChange: (v: string) => void;
}) {
  const activeIndex = options.findIndex(([val]) => val === value);

  return (
    <div
      className="relative grid rounded-lg border border-white/[0.08] bg-black/20 p-0.5"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {activeIndex >= 0 && (
        <span
          aria-hidden
          className="segment-indicator absolute bottom-0.5 left-0.5 top-0.5 rounded-md bg-[var(--accent)]"
          style={{
            width: `calc((100% - 4px) / ${options.length})`,
            transform: `translateX(${activeIndex * 100}%)`,
          }}
        />
      )}
      {options.map(([val, label]) => (
        <button
          key={val}
          type="button"
          onClick={() => onChange(val)}
          className={`relative z-10 rounded-md px-2 py-1.5 text-sm transition-colors ${
            value === val
              ? "font-medium text-[var(--accent-contrast)]"
              : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
