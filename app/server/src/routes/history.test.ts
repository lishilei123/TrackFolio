import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveRange } from "./history.js";

test("history range uses default settlement timezone when UTC is still the previous day", () => {
  const now = new Date("2026-06-07T16:30:00.000Z"); // 2026-06-08 00:30 Beijing

  assert.deepEqual(resolveRange("7d", undefined, undefined, now), {
    from: "2026-06-02",
    to: "2026-06-08",
  });
});

test("history range can resolve with a non-default settlement timezone", () => {
  const now = new Date("2026-06-07T16:30:00.000Z"); // 2026-06-07 12:30 New York

  assert.deepEqual(resolveRange("7d", undefined, undefined, now, "America/New_York"), {
    from: "2026-06-01",
    to: "2026-06-07",
  });
});
