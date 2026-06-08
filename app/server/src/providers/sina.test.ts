import assert from "node:assert/strict";
import { test } from "node:test";
import { marketStatusFor } from "./sina.js";

test("US market status uses New York regular-session boundaries during daylight time", () => {
  assert.equal(marketStatusFor("US", new Date("2026-06-08T13:29:00.000Z")), "pre");
  assert.equal(marketStatusFor("US", new Date("2026-06-08T13:30:00.000Z")), "open");
  assert.equal(marketStatusFor("US", new Date("2026-06-08T20:00:00.000Z")), "post");
  assert.equal(marketStatusFor("US", new Date("2026-06-09T00:00:00.000Z")), "closed");
});

test("US market status uses New York regular-session boundaries during standard time", () => {
  assert.equal(marketStatusFor("US", new Date("2026-01-05T14:29:00.000Z")), "pre");
  assert.equal(marketStatusFor("US", new Date("2026-01-05T14:30:00.000Z")), "open");
  assert.equal(marketStatusFor("US", new Date("2026-01-05T21:00:00.000Z")), "post");
  assert.equal(marketStatusFor("US", new Date("2026-01-06T01:00:00.000Z")), "closed");
});

test("US market status closes on New York weekends", () => {
  assert.equal(marketStatusFor("US", new Date("2026-06-07T14:00:00.000Z")), "closed");
});
