import assert from "node:assert/strict";
import { trialSummary } from "../lib/admin-trials.js";

const now = new Date("2026-09-21T06:00:00.000Z");

assert.equal(trialSummary({}, now), null);

const active = trialSummary({
  trialStartedAt: "2026-09-19T06:00:00.000Z",
  trialEndsAt: "2026-09-26T06:00:00.000Z",
}, now);
assert.equal(active.status, "active");
assert.equal(active.daysLeft, 5);
assert.equal(active.targetable, false);

const lastDay = trialSummary({
  trialStartedAt: "2026-09-14T18:00:00.000Z",
  trialEndsAt: "2026-09-21T18:00:00.000Z",
}, now);
assert.equal(lastDay.daysLeft, 1);

const expired = trialSummary({
  trialStartedAt: "2026-09-10T06:00:00.000Z",
  trialEndsAt: "2026-09-17T06:00:00.000Z",
}, now);
assert.equal(expired.status, "expired-unpaid");
assert.equal(expired.daysLeft, 0);
assert.equal(expired.daysSinceEnd, 4);
assert.equal(expired.targetable, true);

const converted = trialSummary({
  trialStartedAt: "2026-09-10T06:00:00.000Z",
  trialEndsAt: "2026-09-17T06:00:00.000Z",
  latestPaymentOrderId: "paid-order-1",
}, now);
assert.equal(converted.status, "converted");
assert.equal(converted.targetable, false);

console.log("Admin trial classification: all checks pass");
