import assert from "node:assert/strict";
import { test } from "node:test";
import type { Asset } from "../domain/types.js";
import { hasUsableNasdaqHistory, NasdaqHistoryProvider, parseNasdaqHistoryRows } from "./nasdaq.js";

function asset(over: Partial<Asset> = {}): Asset {
  return {
    id: "a1",
    asset_type: "STOCK",
    market: "US",
    symbol: "HYLN",
    name: "Hyliion",
    currency: "USD",
    exchange: null,
    fund_type: null,
    quote_status: "ok",
    created_at: "",
    updated_at: "",
    ...over,
  };
}

test("Nasdaq history rows are parsed, de-duplicated, and sorted ascending", () => {
  const rows = parseNasdaqHistoryRows([
    { date: "06/05/2026", close: "$6.90" },
    { date: "06/04/2026", close: "$7.62" },
    { date: "bad", close: "$1.00" },
    { date: "06/04/2026", close: "$7.63" },
  ]);

  assert.deepEqual(rows, [
    { date: "2026-06-04", close: 7.63 },
    { date: "2026-06-05", close: 6.9 },
  ]);
});

test("Nasdaq history validation accepts holidays but rejects stale or broken series", () => {
  assert.equal(
    hasUsableNasdaqHistory(
      [
        { date: "2026-06-03", close: 7.1 },
        { date: "2026-06-05", close: 6.9 },
      ],
      "2026-06-07",
    ),
    true,
  );
  assert.equal(hasUsableNasdaqHistory([{ date: "2026-05-20", close: 6.9 }], "2026-06-07"), false);
  assert.equal(
    hasUsableNasdaqHistory(
      [
        { date: "2026-05-20", close: 7.1 },
        { date: "2026-06-05", close: 6.9 },
      ],
      "2026-06-07",
    ),
    false,
  );
});

test("Nasdaq provider never supplies realtime quote or nav", async () => {
  const p = new NasdaqHistoryProvider();
  assert.deepEqual(await p.fetchQuote(asset()), { ok: false, reason: "unavailable" });
  assert.deepEqual(await p.fetchNav(asset()), { ok: false, reason: "unavailable" });
});
