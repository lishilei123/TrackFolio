import { settingsRepo } from "../repositories/settings.js";

let includePremarketPnlForTest: boolean | null = null;
let includePostmarketPnlForTest: boolean | null = null;

function displayFlag(key: "use_us_premarket_pnl" | "use_us_postmarket_pnl"): boolean {
  try {
    return settingsRepo.getDisplay()[key];
  } catch {
    return false;
  }
}

export function includePremarketPnl(): boolean {
  return includePremarketPnlForTest ?? displayFlag("use_us_premarket_pnl");
}

export function includePostmarketPnl(): boolean {
  return includePostmarketPnlForTest ?? displayFlag("use_us_postmarket_pnl");
}

export function __setExtendedHoursPnlForTest(settings: { premarket?: boolean | null; postmarket?: boolean | null }): void {
  if ("premarket" in settings) includePremarketPnlForTest = settings.premarket ?? null;
  if ("postmarket" in settings) includePostmarketPnlForTest = settings.postmarket ?? null;
}
