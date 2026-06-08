import type { Currency } from "../../domain/types.js";
import type { FxProvider, FxProviderResult } from "./types.js";
import { normalizeFromBase } from "./types.js";

interface ErApiResponse {
  result?: string;
  time_last_update_utc?: string;
  time_last_update_unix?: number;
  rates?: Record<string, number>;
}

export class ExchangeRateProvider implements FxProvider {
  readonly name = "exchangerate";

  async fetchRates(currencies: Currency[]): Promise<FxProviderResult> {
    try {
      const base: Currency = "USD";
      const res = await fetch(`https://open.er-api.com/v6/latest/${base}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return { ok: false, reason: "unavailable" };
      const json = (await res.json()) as ErApiResponse;
      if (json.result && json.result !== "success") return { ok: false, reason: "unavailable" };
      const rates = json.rates ?? {};
      const rateTime = json.time_last_update_unix
        ? new Date(json.time_last_update_unix * 1000).toISOString()
        : new Date().toISOString();
      const rows = normalizeFromBase(base, rates as Partial<Record<Currency, number>>, currencies, this.name, rateTime);
      return rows ? { ok: true, data: rows } : { ok: false, reason: "unavailable" };
    } catch {
      return { ok: false, reason: "error" };
    }
  }
}
