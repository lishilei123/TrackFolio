import type { Currency } from "../../domain/types.js";

export interface FxRate {
  base_currency: Currency;
  target_currency: Currency;
  rate: number;
  rate_time: string;
  provider: string;
}

export type FxProviderResult =
  | { ok: true; data: FxRate[] }
  | { ok: false; reason: "unavailable" | "error" };

export interface FxProvider {
  readonly name: string;
  fetchRates(currencies: Currency[]): Promise<FxProviderResult>;
}

export function isPositiveRate(rate: unknown): rate is number {
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
}

export function normalizeFromBase(
  base: Currency,
  baseRates: Partial<Record<Currency, number>>,
  currencies: Currency[],
  provider: string,
  rateTime = new Date().toISOString(),
): FxRate[] | null {
  const toBase: Partial<Record<Currency, number>> = { [base]: 1 };
  for (const c of currencies) {
    if (c === base) continue;
    const r = baseRates[c];
    if (!isPositiveRate(r)) return null;
    toBase[c] = r;
  }

  const rows: FxRate[] = [];
  for (const from of currencies) {
    for (const to of currencies) {
      const fromPerBase = toBase[from];
      const toPerBase = toBase[to];
      if (!isPositiveRate(fromPerBase) || !isPositiveRate(toPerBase)) return null;
      rows.push({
        base_currency: from,
        target_currency: to,
        rate: from === to ? 1 : toPerBase / fromPerBase,
        rate_time: rateTime,
        provider,
      });
    }
  }
  return rows;
}
