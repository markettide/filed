import crypto from "node:crypto";

process.env.CASHFREE_CLIENT_ID = "test-client";
process.env.CASHFREE_CLIENT_SECRET = "test-secret";
const { verifyCashfreeWebhook, webhookTimestampIsFresh } = await import("../lib/cashfree.js");

const failures = [];
function check(value, message) {
  if (!value) failures.push(message);
}

const rawBody = JSON.stringify({ type: "PAYMENT_SUCCESS_WEBHOOK" });
const now = Date.now();
const timestamp = String(now);
const signature = crypto.createHmac("sha256", process.env.CASHFREE_CLIENT_SECRET)
  .update(`${timestamp}${rawBody}`)
  .digest("base64");

check(webhookTimestampIsFresh(timestamp, now), "a current webhook timestamp is accepted");
check(!webhookTimestampIsFresh(String(now - 6 * 60 * 1000), now), "a stale webhook timestamp is rejected");
check(verifyCashfreeWebhook({ rawBody, signature, timestamp, now }), "a fresh signed webhook is accepted");
check(!verifyCashfreeWebhook({ rawBody, signature, timestamp: String(now - 6 * 60 * 1000), now }), "a correctly signed replay outside the window is rejected");
check(!verifyCashfreeWebhook({ rawBody: `${rawBody} `, signature, timestamp, now }), "a modified webhook body is rejected");

console.log(`${5} checks`);
if (failures.length) {
  for (const failure of failures) console.error(`FAILED: ${failure}`);
  process.exit(1);
}
console.log("all pass");
