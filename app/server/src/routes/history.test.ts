import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveRange } from "./history.js";

test("history range uses Beijing date when UTC is still the previous day", () => {
  const now = new Date("2026-06-07T16:30:00.000Z"); // 2026-06-08 00:30 Beijing

  assert.deepEqual(resolveRange("7d", undefined, undefined, now), {
    from: "2026-06-02",
    to: "2026-06-08",
  });
});

