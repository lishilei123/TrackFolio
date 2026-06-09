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

test("HK market status uses HKEX pre-opening and regular-session boundaries", () => {
  assert.equal(marketStatusFor("HK", new Date("2026-06-09T00:59:00.000Z")), "closed");
  assert.equal(marketStatusFor("HK", new Date("2026-06-09T01:00:00.000Z")), "pre");
  assert.equal(marketStatusFor("HK", new Date("2026-06-09T01:29:00.000Z")), "pre");
  assert.equal(marketStatusFor("HK", new Date("2026-06-09T01:30:00.000Z")), "open");
  assert.equal(marketStatusFor("HK", new Date("2026-06-09T08:00:00.000Z")), "post");
  assert.equal(marketStatusFor("HK", new Date("2026-06-09T08:10:00.000Z")), "closed");
});

test("CN market status uses opening auction and continuous-session boundaries", () => {
  assert.equal(marketStatusFor("CN", new Date("2026-06-09T01:14:00.000Z")), "closed");
  assert.equal(marketStatusFor("CN", new Date("2026-06-09T01:15:00.000Z")), "pre");
  assert.equal(marketStatusFor("CN", new Date("2026-06-09T01:29:00.000Z")), "pre");
  assert.equal(marketStatusFor("CN", new Date("2026-06-09T01:30:00.000Z")), "open");
  assert.equal(marketStatusFor("CN", new Date("2026-06-09T03:30:00.000Z")), "closed");
  assert.equal(marketStatusFor("CN", new Date("2026-06-09T05:00:00.000Z")), "open");
  assert.equal(marketStatusFor("CN", new Date("2026-06-09T07:00:00.000Z")), "post");
  assert.equal(marketStatusFor("CN", new Date("2026-06-09T07:05:00.000Z")), "closed");
});
