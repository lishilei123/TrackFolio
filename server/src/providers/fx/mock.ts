import type { Currency } from "../../domain/types.js";
import type { FxProvider, FxProviderResult } from "./types.js";
import { normalizeFromBase } from "./types.js";

export class MockFxProvider implements FxProvider {
  readonly name = "mock";

  async fetchRates(currencies: Currency[]): Promise<FxProviderResult> {
    const rows = normalizeFromBase("USD", { USD: 1, CNY: 7.25, HKD: 7.8 }, currencies, this.name);
    return rows ? { ok: true, data: rows } : { ok: false, reason: "error" };
  }
}
