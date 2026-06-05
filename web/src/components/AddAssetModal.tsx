import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api";
import type { Asset, AssetType, Currency, Market, Meta, SearchResult } from "../types";
import { MARKET_LABEL } from "../lib/format";

interface Props {
  meta: Meta;
  onClose: () => void;
  onCreated: () => void;
}

export function AddAssetModal({ meta, onClose, onCreated }: Props) {
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

  // 交易（建仓）字段
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("0");
  const [openedAt, setOpenedAt] = useState("");
  const [tags, setTags] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasIdentity = picked !== null || manual;

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

  const submit = async () => {
    setError(null);
    const qty = Number(quantity);
    const px = Number(price);
    if (!symbol.trim() || !name.trim()) return setError("请先搜索选择或手动录入标的");
    if (!Number.isFinite(qty) || qty <= 0) return setError("请填写有效的买入数量");
    if (!Number.isFinite(px) || px < 0) return setError("请填写有效的买入价");

    setSubmitting(true);
    try {
      let asset: Asset;
      try {
        asset = await api.createAsset({
          asset_type: assetType,
          market,
          symbol: symbol.trim().toUpperCase(),
          name: name.trim(),
          currency,
          fund_type: assetType === "FUND" ? fundType : null,
          allow_custom: allowCustom,
        });
      } catch (e) {
        // 资产已存在 → 复用该资产，本次买入按加仓处理（成本自动重算）
        if (e instanceof ApiError && e.status === 409) {
          asset = (e.detail as { asset: Asset }).asset;
        } else {
          throw e;
        }
      }

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
      setError(e instanceof Error ? e.message : "添加失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto modal-backdrop p-4 pt-16 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="panel fade-in w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
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

        {/* 交易（建仓）字段 —— 选定标的后展示 */}
        {hasIdentity && (
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
                <input type="date" value={openedAt} onChange={(e) => setOpenedAt(e.target.value)} className={inputCls} />
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

        {error && <div className="mt-3 rounded bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>}

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
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">⌕</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="输入代码、名称或拼音，如 600519 / 茅台 / gzmt / AAPL"
          className={`${inputCls} pl-8`}
          autoFocus
        />
      </div>

      {q.trim() && (
        <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-white/[0.08] bg-black/30">
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
  return (
    <div className="flex gap-0.5 rounded-lg border border-white/[0.08] bg-black/20 p-0.5">
      {options.map(([val, label]) => (
        <button
          key={val}
          type="button"
          onClick={() => onChange(val)}
          className={`flex-1 rounded-md px-2 py-1.5 text-sm transition-colors ${
            value === val
              ? "bg-[var(--accent)] font-medium text-[#04201c]"
              : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
