import test from "node:test";
import assert from "node:assert/strict";
import { marketStatusFor } from "./marketHours.js";

test("market status closes on exchange holidays", () => {
  assert.equal(marketStatusFor("US", new Date("2026-06-19T14:00:00.000Z")), "closed");
  assert.equal(marketStatusFor("HK", new Date("2026-06-19T02:00:00.000Z")), "closed");
  assert.equal(marketStatusFor("CN", new Date("2026-06-19T02:00:00.000Z")), "closed");
});

test("US market status uses early close schedule", () => {
  assert.equal(marketStatusFor("US", new Date("2025-07-03T16:59:00.000Z")), "open");
  assert.equal(marketStatusFor("US", new Date("2025-07-03T17:00:00.000Z")), "post");
});

test("HK market status handles lunch break and half days", () => {
  assert.equal(marketStatusFor("HK", new Date("2026-06-09T03:59:00.000Z")), "open");
  assert.equal(marketStatusFor("HK", new Date("2026-06-09T04:00:00.000Z")), "closed");
  assert.equal(marketStatusFor("HK", new Date("2026-06-09T05:00:00.000Z")), "open");
  assert.equal(marketStatusFor("HK", new Date("2026-02-16T03:59:00.000Z")), "open");
  assert.equal(marketStatusFor("HK", new Date("2026-02-16T04:00:00.000Z")), "closed");
});
