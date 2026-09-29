import assert from "node:assert/strict";
import {
  processTrialReminders,
  reminderStageForProfile,
  trialReminderMessage,
} from "../lib/trial-reminders.js";

const now = new Date("2026-09-28T10:00:00.000Z");
const endedToday = new Date("2026-09-28T09:00:00.000Z");
const endedEightDaysAgo = new Date("2026-09-20T09:00:00.000Z");

assert.equal(reminderStageForProfile({ trialEndsAt: new Date("2026-09-29T11:00:00.000Z") }, now), null);
assert.equal(reminderStageForProfile({ trialEndsAt: new Date("2026-09-29T08:00:00.000Z") }, now), "last-day");
assert.equal(reminderStageForProfile({
  trialEndsAt: new Date("2026-09-29T08:00:00.000Z"),
  trialLastDayReminderSentAt: now,
}, now), null);
assert.equal(reminderStageForProfile({ trialEndsAt: endedToday }, now), "expired");
assert.equal(reminderStageForProfile({ trialEndsAt: endedEightDaysAgo, trialExpiryReminderSentAt: now }, now), null);
assert.equal(reminderStageForProfile({
  trialEndsAt: endedEightDaysAgo,
  trialExpiryReminderSentAt: new Date("2026-09-20T10:00:00.000Z"),
}, now), "followup");
assert.equal(reminderStageForProfile({
  trialEndsAt: endedEightDaysAgo,
  trialExpiryReminderSentAt: now,
  trialFollowupReminderSentAt: now,
}, now), null);
assert.equal(reminderStageForProfile({ trialEndsAt: endedToday, latestPaymentOrderId: "paid-order" }, now), null);
assert.equal(reminderStageForProfile({ trialEndsAt: endedToday, premiumOrderIds: ["paid-order"] }, now), null);

const first = trialReminderMessage({
  email: "reader@example.com",
  name: "Asha <Investor>",
  trialEndsAt: endedToday,
}, "expired");
const lastDay = trialReminderMessage({
  email: "reader@example.com",
  name: "Asha <Investor>",
  trialEndsAt: new Date("2026-09-29T08:00:00.000Z"),
}, "last-day");
const second = trialReminderMessage({
  email: "reader@example.com",
  name: "Asha <Investor>",
  trialEndsAt: endedToday,
}, "followup");
assert.notEqual(first.subject, second.subject);
assert.notEqual(lastDay.subject, first.subject);
assert.match(lastDay.subject, /ends tomorrow/);
assert.match(lastDay.text, /final day/);
assert.notEqual(first.idempotencyKey, second.idempotencyKey);
assert.notEqual(lastDay.idempotencyKey, first.idempotencyKey);
assert.equal(first.idempotencyKey, trialReminderMessage({
  email: "reader@example.com",
  trialEndsAt: endedToday,
}, "expired").idempotencyKey);
assert.match(first.text, /₹299 for three months/);
assert.match(second.text, /less than ₹4 per day/);
assert.match(first.html, /Asha/);
assert.doesNotMatch(first.html, /Asha <Investor>/);

const sent = [];
const completed = [];
const released = [];
const result = await processTrialReminders({
  now,
  services: {
    list: async () => [
      { email: "last-day@example.com", trialEndsAt: new Date("2026-09-29T08:00:00.000Z") },
      { email: "newly-expired@example.com", trialEndsAt: endedToday },
      { email: "followup@example.com", trialEndsAt: endedEightDaysAgo, trialExpiryReminderSentAt: new Date("2026-09-20T10:00:00.000Z") },
      { email: "customer@example.com", trialEndsAt: endedToday, latestPaymentOrderId: "paid-order" },
    ],
    claim: async () => true,
    send: async (message) => {
      sent.push(message);
      return { sent: true, id: `resend-${sent.length}` };
    },
    complete: async (record) => completed.push(record),
    release: async (record) => released.push(record),
  },
});

assert.deepEqual(
  { checked: result.checked, due: result.due, sent: result.sent, skipped: result.skipped, failed: result.failed },
  { checked: 4, due: 3, sent: 3, skipped: 1, failed: 0 }
);
assert.deepEqual(result.stages, { "last-day": 1, expired: 1, followup: 1 });
assert.equal(sent.length, 3);
assert.equal(completed.length, 3);
assert.equal(released.length, 0);

const dryRun = await processTrialReminders({
  now,
  dryRun: true,
  services: {
    list: async () => [{ email: "dry@example.com", trialEndsAt: endedToday }],
    claim: async () => { throw new Error("dry run must not claim"); },
    send: async () => { throw new Error("dry run must not send"); },
  },
});
assert.equal(dryRun.due, 1);
assert.equal(dryRun.sent, 0);

const savedCronSecret = process.env.CRON_SECRET;
const savedMongoUri = process.env.MONGODB_URI;
const { GET } = await import("../app/api/cron/trial-reminders/route.js");
delete process.env.CRON_SECRET;
assert.equal((await GET(new Request("https://example.test/api/cron/trial-reminders"))).status, 404);
process.env.CRON_SECRET = "test-cron-secret";
delete process.env.MONGODB_URI;
assert.equal((await GET(new Request("https://example.test/api/cron/trial-reminders", {
  headers: { Authorization: "Bearer test-cron-secret" },
}))).status, 503);
if (savedCronSecret === undefined) delete process.env.CRON_SECRET;
else process.env.CRON_SECRET = savedCronSecret;
if (savedMongoUri === undefined) delete process.env.MONGODB_URI;
else process.env.MONGODB_URI = savedMongoUri;

console.log("Trial reminder sequence: all checks pass");
