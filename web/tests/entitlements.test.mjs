import assert from "node:assert/strict";

const { accessForProfile } = await import("../lib/entitlements.js");
const now = new Date("2026-09-19T10:00:00.000Z");

assert.deepEqual(
  accessForProfile(null, now),
  {
    level: "free",
    premium: false,
    paidActive: false,
    trialActive: false,
    trialAvailable: true,
    trialStartedAt: null,
    trialEndsAt: null,
    paidStartsAt: null,
    paidEndsAt: null,
  }
);

const trial = accessForProfile({
  trialStartedAt: new Date("2026-09-18T10:00:00.000Z"),
  trialEndsAt: new Date("2026-09-25T10:00:00.000Z"),
}, now);
assert.equal(trial.level, "trial");
assert.equal(trial.premium, true);
assert.equal(trial.trialAvailable, false);

const expired = accessForProfile({
  trialStartedAt: new Date("2026-09-01T10:00:00.000Z"),
  trialEndsAt: new Date("2026-09-08T10:00:00.000Z"),
}, now);
assert.equal(expired.level, "free");
assert.equal(expired.premium, false);
assert.equal(expired.trialAvailable, false);

const paid = accessForProfile({
  trialStartedAt: new Date("2026-08-01T10:00:00.000Z"),
  trialEndsAt: new Date("2026-08-08T10:00:00.000Z"),
  subscriptionPlan: "premium",
  subscriptionStatus: "active",
  subscriptionStartsAt: new Date("2026-09-10T10:00:00.000Z"),
  subscriptionEndsAt: new Date("2026-12-10T10:00:00.000Z"),
}, now);
assert.equal(paid.level, "paid");
assert.equal(paid.premium, true);

const expiredPaid = accessForProfile({
  subscriptionPlan: "premium",
  subscriptionStatus: "active",
  subscriptionEndsAt: new Date("2026-09-18T10:00:00.000Z"),
}, now);
assert.equal(expiredPaid.level, "free");
assert.equal(expiredPaid.premium, false);

const formerPaid = accessForProfile({ latestPaymentOrderId: "mt_old_order" }, now);
assert.equal(formerPaid.trialAvailable, false);

console.log("Entitlement tests passed.");
