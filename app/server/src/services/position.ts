import type { Position } from "../domain/types.js";
import { positionsRepo } from "../repositories/positions.js";
import { transactionsRepo } from "../repositories/transactions.js";
import type { Transaction } from "../repositories/transactions.js";

function round(n: number, d = 6): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

export interface ComputedCost {
  quantity: number;
  avg_cost: number; // 加权平均成本（纯价格，费用单列）
  total_fee: number;
  opened_at: string | null;
  closed_at: string | null;
}

export type CostTx = Pick<Transaction, "side" | "quantity" | "price" | "fee" | "trade_time">;

/** 校验用交易：带可选 created_at/id，用于同一 trade_time 时与落库回放顺序保持一致 */
export type CostFlowTx = CostTx & { id?: string; created_at?: string };

const EPS = 1e-9;

// 尚未落库的新交易没有 created_at，回放时排在同日已有交易之后，
// 与落库后 listByAsset 的 `trade_time ASC, created_at ASC`（新交易 created_at 最新）一致。
const REPLAY_CREATED_LAST = "￿";

function compareReplayOrder(a: CostFlowTx, b: CostFlowTx): number {
  if (a.trade_time !== b.trade_time) return a.trade_time < b.trade_time ? -1 : 1;
  const ca = a.created_at ?? REPLAY_CREATED_LAST;
  const cb = b.created_at ?? REPLAY_CREATED_LAST;
  if (ca !== cb) return ca < cb ? -1 : 1;
  const ia = a.id ?? "";
  const ib = b.id ?? "";
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

/**
 * 把一组交易（含尚未落库的待写入交易）按落库回放顺序走一遍 walkCost，
 * 命中卖超等非法状态时返回 reason，否则返回 null。排序口径与重算保持一致。
 */
export function validateCostFlow(txs: CostFlowTx[]): string | null {
  try {
    walkCost([...txs].sort(compareReplayOrder));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "invalid_transaction_flow";
  }
}

export interface DailyCostState extends ComputedCost {
  date: string;
}

interface CostState {
  quantity: number;
  avgCost: number;
  totalFee: number;
  openedAt: string | null;
  lastTime: string | null;
}

function newCostState(): CostState {
  return { quantity: 0, avgCost: 0, totalFee: 0, openedAt: null, lastTime: null };
}

function applyCostTx(state: CostState, tx: CostTx): void {
  state.totalFee += tx.fee;
  state.lastTime = tx.trade_time;
  if (tx.side === "BUY") {
    if (!state.openedAt) state.openedAt = tx.trade_time;
    const newQty = state.quantity + tx.quantity;
    if (newQty > 0) state.avgCost = (state.avgCost * state.quantity + tx.price * tx.quantity) / newQty;
    state.quantity = newQty;
  } else {
    if (tx.quantity > state.quantity + EPS) {
      throw new Error("sell_quantity_exceeds_position");
    }
    state.quantity -= tx.quantity;
    if (state.quantity <= EPS) state.quantity = 0;
  }
}

function snapshotCost(state: CostState, hasTx: boolean): ComputedCost {
  return {
    quantity: round(state.quantity),
    avg_cost: round(state.avgCost),
    total_fee: round(state.totalFee, 2),
    opened_at: state.openedAt,
    closed_at: hasTx && state.quantity === 0 ? state.lastTime : null,
  };
}

function dateOf(tx: CostTx): string {
  return tx.trade_time.slice(0, 10);
}

/**
 * 纯函数：按加权平均法走一遍交易流水推算成本（需求 5.3 调整成本 / 7.3 Transaction）。
 * 交易需按时间升序传入。买入摊薄成本，卖出不改变成本价。
 */
export function walkCost(txs: CostTx[]): ComputedCost {
  const state = newCostState();
  for (const tx of txs) applyCostTx(state, tx);
  return snapshotCost(state, txs.length > 0);
}

/** 单笔卖出兑现的已实现盈亏（加权平均法，扣除该笔卖出费用） */
export interface RealizedLot {
  trade_time: string;
  quantity: number;
  sell_price: number;
  /** 卖出当时的加权平均成本（纯价格，买入费用不分摊） */
  avg_cost: number;
  /** 卖出金额 = sell_price * quantity */
  proceeds: number;
  /** 成本基准 = avg_cost * quantity */
  cost_basis: number;
  /** 该笔卖出费用 */
  fee: number;
  /** 已实现盈亏 = (sell_price - avg_cost) * quantity - fee */
  realized_pnl: number;
  /** 收益率 = realized_pnl / cost_basis */
  realized_pnl_percent: number | null;
}

/**
 * 纯函数：按加权平均法回放交易流水，在每笔卖出处生成一条已实现盈亏记录。
 * 卖出时取「卖出前」的运行均价作为成本，已实现盈亏扣除该笔卖出费用（需求 5.3 / 5.7.3 单列扣费口径）。
 * 交易需按时间升序传入（与 transactionsRepo.listByAsset 回放口径一致）。
 */
export function walkRealized(txs: CostTx[]): RealizedLot[] {
  const state = newCostState();
  const lots: RealizedLot[] = [];
  for (const tx of txs) {
    if (tx.side === "SELL") {
      const avgCost = state.avgCost;
      const quantity = tx.quantity;
      const proceeds = tx.price * quantity;
      const costBasis = avgCost * quantity;
      const realized = proceeds - costBasis - tx.fee;
      lots.push({
        trade_time: tx.trade_time,
        quantity,
        sell_price: tx.price,
        avg_cost: round(avgCost),
        proceeds: round(proceeds, 2),
        cost_basis: round(costBasis, 2),
        fee: round(tx.fee, 2),
        realized_pnl: round(realized, 2),
        realized_pnl_percent: costBasis !== 0 ? round((realized / costBasis) * 100, 4) : null,
      });
    }
    applyCostTx(state, tx);
  }
  return lots;
}

/** 按日期回放交易流水，返回每个日期收盘后的持仓成本状态。 */
export function buildDailyCostStates(txs: CostTx[], dates: string[]): DailyCostState[] {
  const state = newCostState();
  let txIndex = 0;
  return dates.map((date) => {
    while (txIndex < txs.length && dateOf(txs[txIndex]) <= date) {
      applyCostTx(state, txs[txIndex]);
      txIndex++;
    }
    return { date, ...snapshotCost(state, txIndex > 0) };
  });
}

/** 由交易流水推算某资产的持仓数量与成本 */
export async function computeCostFromTransactions(assetId: string): Promise<ComputedCost> {
  return walkCost(await transactionsRepo.listByAsset(assetId));
}

/**
 * 重算并落库持仓。保留 tags/note 等持仓级元数据。
 * 没有任何交易且没有持仓时返回 null。
 */
export async function recomputePosition(assetId: string): Promise<Position | null> {
  const cost = await computeCostFromTransactions(assetId);
  const existing = (await positionsRepo.listByAsset(assetId))[0] ?? null;

  if (!existing) {
    if ((await transactionsRepo.listByAsset(assetId)).length === 0) return null;
    const created = await positionsRepo.create({
      asset_id: assetId,
      quantity: cost.quantity,
      avg_cost: cost.avg_cost,
      total_fee: cost.total_fee,
      opened_at: cost.opened_at,
    });
    // create 不接受 closed_at，必要时补一次更新
    if (cost.closed_at) return positionsRepo.update(created.id, { closed_at: cost.closed_at });
    return created;
  }

  return positionsRepo.update(existing.id, {
    quantity: cost.quantity,
    avg_cost: cost.avg_cost,
    total_fee: cost.total_fee,
    opened_at: cost.opened_at,
    closed_at: cost.closed_at,
  });
}
