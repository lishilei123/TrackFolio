import { type FormEvent, useEffect, useState } from "react";
import { ApiError, api, type CreateTransactionInput, type PendingSipOrder, type UpdateTransactionInput } from "../api";
import type { Holding, Market, Transaction } from "../types";
import { fmtQty } from "../lib/format";
import { useExitTransition } from "../lib/motion";
import { DateField } from "./DateField";

interface Props {
  holding: Holding;
  onClose: () => void;
  onChanged: () => void;
  onLocked: () => void;
}

const inputCls = "input-base h-8 min-w-0";
const numericInputCls = `${inputCls} tnum text-right`;
const dateInputCls = `${inputCls} tnum whitespace-nowrap`;

interface TxForm {
  side: "BUY" | "SELL";
  quantity: string;
  price: string;
  fee: string;
  trade_time: string;
  note: string;
}

function emptyForm(): TxForm {
  return { side: "BUY", quantity: "", price: "", fee: "0", trade_time: "", note: "" };
}

function formFromTx(tx: Transaction): TxForm {
  return {
    side: tx.side,
    quantity: String(tx.quantity),
    price: String(tx.price),
    fee: String(tx.fee),
    trade_time: tx.trade_time.slice(0, 10),
    note: tx.note ?? "",
  };
}

function toPayload(form: TxForm): CreateTransactionInput | UpdateTransactionInput {
  return {
    side: form.side,
    quantity: Number(form.quantity),
    price: Number(form.price),
    fee: Number(form.fee) || 0,
    trade_time: form.trade_time || null,
    note: form.note.trim() || null,
  };
}

function validate(form: TxForm): string | null {
  const qty = Number(form.quantity);
  const price = Number(form.price);
  const fee = Number(form.fee) || 0;
  if (!Number.isFinite(qty) || qty <= 0) return "请填写有效的交易数量";
  if (!Number.isFinite(price) || price < 0) return "请填写有效的成交价格";
  if (!Number.isFinite(fee) || fee < 0) return "请填写有效的交易费用";
  return null;
}

export function TransactionEditorModal({ holding, onClose, onChanged, onLocked }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pending, setPending] = useState<PendingSipOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState<TxForm>(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<TxForm>(emptyForm());
  const [error, setError] = useState<string | null>(null);
  const { isExiting, requestClose } = useExitTransition(onClose);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [txs, pend] = await Promise.all([
        api.listTransactions(holding.asset.id),
        api.listPendingSip(holding.asset.id),
      ]);
      setTransactions(txs);
      setPending(pend);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onLocked();
      else setError(e instanceof Error ? e.message : "交易流水加载失败");
    } finally {
      setLoading(false);
    }
  };

  const removePending = async (id: string) => {
    if (!confirm("删除这条待确认定投？后台将不再为其自动补录。")) return;
    setSaving(true);
    setError(null);
    try {
      await api.deletePendingSip(id);
      setPending(await api.listPendingSip(holding.asset.id));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onLocked();
      else setError(e instanceof Error ? e.message : "删除待确认失败");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    void load();
  }, [holding.asset.id]);

  const afterMutation = async () => {
    await load();
    onChanged();
  };

  const submitAdd = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const err = validate(addForm);
    if (err) return setError(err);
    setSaving(true);
    try {
      await api.createTransaction(holding.asset.id, toPayload(addForm) as CreateTransactionInput);
      setAddForm(emptyForm());
      setAdding(false);
      await afterMutation();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onLocked();
      else setError(e instanceof Error ? e.message : "新增交易失败");
    } finally {
      setSaving(false);
    }
  };

  const submitEdit = async (txId: string) => {
    setError(null);
    const err = validate(editForm);
    if (err) return setError(err);
    setSaving(true);
    try {
      await api.updateTransaction(txId, toPayload(editForm) as UpdateTransactionInput);
      setEditingId(null);
      await afterMutation();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onLocked();
      else setError(e instanceof Error ? e.message : "保存交易失败");
    } finally {
      setSaving(false);
    }
  };

  const removeTx = async (tx: Transaction) => {
    if (!confirm("确认删除这笔交易流水？这仅用于纠错，会重算持仓和历史盈亏。")) return;
    setSaving(true);
    setError(null);
    try {
      await api.deleteTransaction(tx.id);
      await afterMutation();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onLocked();
      else setError(e instanceof Error ? e.message : "删除交易失败");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (tx: Transaction) => {
    setEditingId(tx.id);
    setEditForm(formFromTx(tx));
  };

  return (
    <div
      className="motion-modal-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto modal-backdrop p-3 pt-8 backdrop-blur-md sm:p-4 sm:pt-12"
      data-closing={isExiting || undefined}
      onClick={requestClose}
    >
      <div
        className="motion-modal-panel panel w-full max-w-6xl p-4 sm:p-5"
        data-closing={isExiting || undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="label">Transactions</div>
            <h2 className="truncate text-base font-semibold text-slate-50">编辑交易 · {holding.asset.name || holding.asset.symbol}</h2>
            <p className="mt-1 text-xs text-slate-500">持仓数量与成本由交易流水自动推算，当前持仓 {fmtQty(holding.position.quantity)}</p>
          </div>
          <button onClick={requestClose} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-slate-200">✕</button>
        </div>

        {error && <div className="content-reveal mb-3 rounded bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>}

        <div className="mb-3 flex justify-stretch sm:justify-end">
          <button onClick={() => setAdding((v) => !v)} className="btn-accent w-full px-3.5 py-2 text-xs sm:w-auto sm:py-1.5">{adding ? "收起" : "+ 新增交易"}</button>
        </div>

        {adding && <TxFormPanel form={addForm} setForm={setAddForm} onSubmit={submitAdd} submitting={saving} submitText="新增交易" market={holding.asset.market} />}

        {pending.length > 0 && (
          <div className="content-reveal mb-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3">
            <div className="mb-2 text-xs font-medium text-amber-300">
              待确认定投 {pending.length} 期 · 净值披露后由后台自动折算补录
            </div>
            <div className="space-y-1">
              {pending.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                  <span className="tnum">
                    {p.nav_date} 申购 · {p.trade_time} 确认 · {p.sip_mode === "amount" ? `¥${p.per_value}` : `${p.per_value} 份`}
                  </span>
                  <button
                    disabled={saving}
                    onClick={() => void removePending(p.id)}
                    className="rounded-md px-2 py-0.5 text-rose-400 hover:bg-rose-500/10 disabled:opacity-50"
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-white/[0.06]">
          <div className="divide-y divide-white/[0.06] md:hidden">
            {loading ? (
              <div className="px-3 py-8 text-center text-sm text-slate-600">加载中...</div>
            ) : transactions.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-slate-600">暂无交易流水</div>
            ) : transactions.map((tx, i) => (
              <MobileTransactionItem
                key={tx.id}
                tx={tx}
                index={i}
                editing={editingId === tx.id}
                form={editForm}
                setForm={setEditForm}
                saving={saving}
                market={holding.asset.market}
                onEdit={() => startEdit(tx)}
                onCancel={() => setEditingId(null)}
                onSave={() => void submitEdit(tx.id)}
                onRemove={() => void removeTx(tx)}
              />
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[1000px] table-fixed text-sm">
              <colgroup>
                <col className="w-[96px]" />
                <col className="w-[140px]" />
                <col className="w-[140px]" />
                <col className="w-[130px]" />
                <col className="w-[156px]" />
                <col className="w-[204px]" />
                <col className="w-[130px]" />
              </colgroup>
              <thead className="bg-white/[0.02] text-left text-[10px] uppercase tracking-[0.08em] text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">方向</th>
                  <th className="px-3 py-2 text-right font-medium">数量</th>
                  <th className="px-3 py-2 text-right font-medium">价格</th>
                  <th className="px-3 py-2 text-right font-medium">费用</th>
                  <th className="px-3 py-2 font-medium">交易日期</th>
                  <th className="px-3 py-2 font-medium">备注</th>
                  <th className="px-3 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-600">加载中...</td></tr>
                ) : transactions.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-600">暂无交易流水</td></tr>
                ) : transactions.map((tx, i) => (
                  <tr
                    key={tx.id}
                    className="data-row border-t border-white/[0.04]"
                    style={{ animationDelay: `${Math.min(i * 16, 120)}ms` }}
                  >
                    {editingId === tx.id ? (
                      <>
                        <td className="px-3 py-2"><select value={editForm.side} onChange={(e) => setEditForm({ ...editForm, side: e.target.value as "BUY" | "SELL" })} className={inputCls}><option value="BUY">买入</option><option value="SELL">卖出</option></select></td>
                        <td className="px-3 py-2"><input value={editForm.quantity} onChange={(e) => setEditForm({ ...editForm, quantity: e.target.value })} className={numericInputCls} inputMode="decimal" /></td>
                        <td className="px-3 py-2"><input value={editForm.price} onChange={(e) => setEditForm({ ...editForm, price: e.target.value })} className={numericInputCls} inputMode="decimal" /></td>
                        <td className="px-3 py-2"><input value={editForm.fee} onChange={(e) => setEditForm({ ...editForm, fee: e.target.value })} className={numericInputCls} inputMode="decimal" /></td>
                        <td className="px-3 py-2"><DateField value={editForm.trade_time} onChange={(v) => setEditForm({ ...editForm, trade_time: v })} className={dateInputCls} tradingDaysOnly market={holding.asset.market} /></td>
                        <td className="px-3 py-2"><input value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} className={inputCls} /></td>
                        <td className="px-3 py-2"><div className="flex justify-end gap-1 whitespace-nowrap"><button disabled={saving} onClick={() => void submitEdit(tx.id)} className="btn-accent px-2 py-1 text-xs disabled:opacity-50">保存</button><button onClick={() => setEditingId(null)} className="btn-ghost px-2 py-1 text-xs text-slate-300">取消</button></div></td>
                      </>
                    ) : (
                      <>
                        <td className={tx.side === "BUY" ? "px-3 py-2.5 text-rose-300" : "px-3 py-2.5 text-emerald-300"}>{tx.side === "BUY" ? "买入" : "卖出"}</td>
                        <td className="tnum px-3 py-2.5 text-right text-slate-300">{tx.quantity}</td>
                        <td className="tnum px-3 py-2.5 text-right text-slate-300">{tx.price}</td>
                        <td className="tnum px-3 py-2.5 text-right text-slate-400">{tx.fee}</td>
                        <td className="tnum px-3 py-2.5 text-slate-400">{tx.trade_time.slice(0, 10)}</td>
                        <td className="px-3 py-2.5 text-slate-500"><span className="block truncate">{tx.note ?? "—"}</span></td>
                        <td className="px-3 py-2.5"><div className="flex justify-end gap-1 whitespace-nowrap"><button onClick={() => startEdit(tx)} className="btn-ghost px-2 py-1 text-xs text-slate-200">编辑</button><button onClick={() => void removeTx(tx)} className="rounded-md px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10">删除流水</button></div></td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileTransactionItem({
  tx,
  index,
  editing,
  form,
  setForm,
  saving,
  market,
  onEdit,
  onCancel,
  onSave,
  onRemove,
}: {
  tx: Transaction;
  index: number;
  editing: boolean;
  form: TxForm;
  setForm: (f: TxForm) => void;
  saving: boolean;
  market: Market;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onRemove: () => void;
}) {
  if (editing) {
    return (
      <article className="data-row p-3" style={{ animationDelay: `${Math.min(index * 16, 120)}ms` }}>
        <div className="grid gap-3">
          <Field label="方向">
            <select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value as "BUY" | "SELL" })} className={inputCls}>
              <option value="BUY">买入</option>
              <option value="SELL">卖出</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="数量">
              <input value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className={numericInputCls} inputMode="decimal" />
            </Field>
            <Field label="价格">
              <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className={numericInputCls} inputMode="decimal" />
            </Field>
            <Field label="费用">
              <input value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} className={numericInputCls} inputMode="decimal" />
            </Field>
            <Field label="交易日期">
              <DateField value={form.trade_time} onChange={(v) => setForm({ ...form, trade_time: v })} className={dateInputCls} tradingDaysOnly market={market} />
            </Field>
          </div>
          <Field label="备注">
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={inputCls} />
          </Field>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button disabled={saving} onClick={onSave} className="btn-accent px-3 py-2 text-xs disabled:opacity-50">
            保存
          </button>
          <button onClick={onCancel} className="btn-ghost px-3 py-2 text-xs text-slate-300">
            取消
          </button>
        </div>
      </article>
    );
  }

  return (
    <article className="data-row p-3" style={{ animationDelay: `${Math.min(index * 16, 120)}ms` }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={tx.side === "BUY" ? "text-sm font-medium text-rose-300" : "text-sm font-medium text-emerald-300"}>
            {tx.side === "BUY" ? "买入" : "卖出"}
          </div>
          <div className="tnum mt-1 text-xs text-slate-500">{tx.trade_time.slice(0, 10)}</div>
        </div>
        <div className="tnum text-right text-xs text-slate-500">{tx.note ?? "—"}</div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <TxMetric label="数量">{tx.quantity}</TxMetric>
        <TxMetric label="价格">{tx.price}</TxMetric>
        <TxMetric label="费用">{tx.fee}</TxMetric>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button onClick={onEdit} className="btn-ghost px-3 py-2 text-xs text-slate-200">
          编辑
        </button>
        <button onClick={onRemove} className="rounded-md border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-400 hover:bg-rose-500/15">
          删除流水
        </button>
      </div>
    </article>
  );
}

function TxMetric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
      <div className="label">{label}</div>
      <div className="tnum mt-1 truncate text-sm text-slate-200">{children}</div>
    </div>
  );
}

function TxFormPanel({ form, setForm, onSubmit, submitting, submitText, market }: { form: TxForm; setForm: (f: TxForm) => void; onSubmit: (e: FormEvent) => void; submitting: boolean; submitText: string; market: Market }) {
  return (
    <form onSubmit={onSubmit} className="content-reveal mb-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="grid gap-3 md:grid-cols-6">
        <Field label="方向"><select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value as "BUY" | "SELL" })} className={inputCls}><option value="BUY">买入</option><option value="SELL">卖出</option></select></Field>
        <Field label="数量"><input value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className={numericInputCls} inputMode="decimal" /></Field>
        <Field label="价格"><input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className={numericInputCls} inputMode="decimal" /></Field>
        <Field label="费用"><input value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} className={numericInputCls} inputMode="decimal" /></Field>
        <Field label="日期"><DateField value={form.trade_time} onChange={(v) => setForm({ ...form, trade_time: v })} className={dateInputCls} tradingDaysOnly market={market} /></Field>
        <div className="flex items-end"><button disabled={submitting} className="btn-accent w-full py-2 text-sm disabled:opacity-50" type="submit">{submitText}</button></div>
      </div>
      <div className="mt-3"><Field label="备注"><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={inputCls} /></Field></div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="label">{label}</span><div className="mt-1">{children}</div></label>;
}
