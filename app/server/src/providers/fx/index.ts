import { settingsRepo } from "../../repositories/settings.js";
import { AutoFxProvider } from "./auto.js";
import { ExchangeRateProvider } from "./exchangerate.js";
import { MockFxProvider } from "./mock.js";
import type { FxProvider } from "./types.js";
import { YahooFxProvider } from "./yahooFx.js";

export const FX_PROVIDER_NAMES = ["auto", "exchangerate", "yahoo", "mock"] as const;
export type FxProviderName = (typeof FX_PROVIDER_NAMES)[number];

function providerByName(name: string): FxProvider {
  switch (name) {
    case "exchangerate":
      return new ExchangeRateProvider();
    case "yahoo":
      return new YahooFxProvider();
    case "mock":
      return new MockFxProvider();
    case "auto":
    default:
      return new AutoFxProvider([new ExchangeRateProvider(), new YahooFxProvider(), new MockFxProvider()]);
  }
}

export function resolveFxProviderName(): FxProviderName {
  const raw = settingsRepo.getDisplay().exchange_rate_provider ?? "auto";
  return FX_PROVIDER_NAMES.includes(raw as FxProviderName) ? raw as FxProviderName : "auto";
}

export function getFxProvider(): FxProvider {
  return providerByName(resolveFxProviderName());
}

export type { FxProvider };
