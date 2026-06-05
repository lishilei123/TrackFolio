import type { Currency } from "../../domain/types.js";
import type { FxProvider, FxProviderResult } from "./types.js";

export class AutoFxProvider implements FxProvider {
  readonly name = "auto";
  constructor(private readonly providers: FxProvider[]) {}

  async fetchRates(currencies: Currency[]): Promise<FxProviderResult> {
    for (const p of this.providers) {
      try {
        const res = await p.fetchRates(currencies);
        if (res.ok) return res;
      } catch {
        /* try next provider */
      }
    }
    return { ok: false, reason: "unavailable" };
  }
}
