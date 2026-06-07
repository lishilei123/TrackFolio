import { getProvider } from "../providers/index.js";
import { assetsRepo } from "../repositories/assets.js";
import { pendingSipRepo, type PendingSipOrder } from "../repositories/pendingSip.js";
import { positionsRepo } from "../repositories/positions.js";
import { transactionsRepo } from "../repositories/transactions.js";
import { recomputeDailyPnlForAsset } from "./history.js";
import { recomputePosition } from "./position.js";

/** 待确认占位长期无法确认（疑似代码错误/数据缺口）的清理阈值（天） */
const EXPIRE_DAYS = 30;

export interface SipFillSummary {
  confirmed: number; // 已折算并落库为正式流水
  stillPending: number; // 净值仍未披露，保持待确认
  expired: number; // 超期无法确认，已清理
  failed: number; // 拉取/处理失败
}

/** 北京时区今日（yyyy-mm-dd）。基金净值披露按 CN 日期。 */
function todayStr(): string {
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
}

function dayDiffInclusive(from: string, to: string): number {
  const start = Date.parse(from + "T00:00:00.000Z");
  const end = Date.parse(to + "T00:00:00.000Z");
  return Math.max(1, Math.floor((end - start) / 86_400_000) + 1);
}

/** 首次建仓时把占位携带的标签写入持仓元数据（持仓尚无标签时） */
async function applyTagsIfNeeded(assetId: string, orders: PendingSipOrder[]): Promise<void> {
  const tagged = orders.find((o) => o.tags && o.tags.length > 0);
  if (!tagged?.tags) return;
  const pos = (await positionsRepo.listByAsset(assetId))[0];
  if (pos && pos.tags.length === 0) await positionsRepo.update(pos.id, { tags: tagged.tags });
}

/**
 * 扫描所有「待确认」定投占位：净值已披露的按申购成交日（T 日）净值折算份额、落为正式交易流水并删占位；
 * 仍未披露的保持待确认（QDII 等 T 日净值披露延迟由此自然吸收）；超期（>EXPIRE_DAYS 仍无法确认）的清理掉。
 * 每个资产有新确认则重算持仓与历史。
 */
export async function fillPendingSipOrders(): Promise<SipFillSummary> {
  const summary: SipFillSummary = { confirmed: 0, stillPending: 0, expired: 0, failed: 0 };
  const provider = getProvider();
  if (!provider.fetchHistory) return summary;

  const today = todayStr();
  for (const assetId of await pendingSipRepo.listAssetIds()) {
    const orders = await pendingSipRepo.listByAsset(assetId);
    if (orders.length === 0) continue;

    const asset = await assetsRepo.get(assetId);
    if (!asset) {
      // 资产已删除，占位无意义，清理
      for (const o of orders) await pendingSipRepo.remove(o.id);
      continue;
    }

    // 净值基准取申购成交日（nav_date）；旧行无 nav_date 时回退用 trade_time
    const navDateOf = (o: PendingSipOrder): string => o.nav_date ?? o.trade_time;

    // 拉取覆盖最早申购日至今日的净值序列（升序）
    const earliest = orders.reduce((m, o) => (navDateOf(o) < m ? navDateOf(o) : m), navDateOf(orders[0]));
    let points: Array<{ date: string; close: number }> = [];
    try {
      const res = await provider.fetchHistory(asset, dayDiffInclusive(earliest, today));
      if (!res.ok) {
        summary.failed += orders.length;
        continue;
      }
      points = res.data;
    } catch {
      summary.failed += orders.length;
      continue;
    }

    let confirmedForAsset = 0;
    for (const o of orders) {
      try {
        // 净值基准取申购成交日（nav_date）净值；落库交易记在份额确认日（trade_time）
        const navDate = navDateOf(o);
        const i = points.findIndex((p) => p.date >= navDate);
        const nav = i >= 0 && points[i].date === navDate ? points[i] : undefined;
        if (!nav || !(nav.close > 0)) {
          // 净值尚未披露：超期则清理，否则维持待确认
          if (dayDiffInclusive(navDate, today) > EXPIRE_DAYS) {
            console.warn(
              `[sipFill] 占位超期清理 id=${o.id} asset=${assetId} nav_date=${navDate}（净值长期未披露）`,
            );
            await pendingSipRepo.remove(o.id);
            summary.expired++;
          } else {
            summary.stillPending++;
          }
          continue;
        }

        const price = nav.close;
        const qty = o.sip_mode === "amount" ? o.per_value / price : o.per_value;
        if (!(qty > 0)) {
          summary.stillPending++;
          continue;
        }
        await transactionsRepo.create({
          asset_id: assetId,
          side: "BUY",
          quantity: qty,
          price,
          fee: o.fee,
          currency: o.currency,
          trade_time: o.trade_time,
          note: o.note ?? "定投",
        });
        await pendingSipRepo.remove(o.id);
        confirmedForAsset++;
        summary.confirmed++;
      } catch (e) {
        console.error(`[sipFill] 占位确认失败 id=${o.id} asset=${assetId}`, e);
        summary.failed++;
      }
    }

    if (confirmedForAsset > 0) {
      try {
        await recomputePosition(assetId);
        await applyTagsIfNeeded(assetId, orders);
        await recomputeDailyPnlForAsset(assetId);
      } catch (e) {
        console.error(`[sipFill] 重算失败 asset=${assetId}`, e);
      }
    }
  }

  return summary;
}
