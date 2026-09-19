import crypto from "node:crypto";

process.env.CASHFREE_CLIENT_ID = "test-client";
process.env.CASHFREE_CLIENT_SECRET = "test-secret";
process.env.KV_REST_API_URL = "https://redis.invalid";
process.env.KV_REST_API_TOKEN = "test-token";

const counters = new Map();
global.fetch = async (_url, init) => {
  const [op, key, value] = JSON.parse(init.body);
  if (op === "INCR") {
    const current = counters.get(key) || { count: 0, expiresAt: null };
    current.count += 1;
    counters.set(key, current);
    return Response.json({ result: current.count });
  }
  if (op === "EXPIRE") {
    const current = counters.get(key);
    current.expiresAt = Date.now() + Number(value) * 1000;
    return Response.json({ result: 1 });
  }
  if (op === "TTL") {
    const current = counters.get(key);
    return Response.json({ result: Math.ceil((current.expiresAt - Date.now()) / 1000) });
  }
  throw new Error(`Unexpected Redis operation ${op}`);
};

const { verifyCashfreeWebhook, webhookTimestampIsFresh } = await import("../lib/cashfree.js");
const { rateLimit } = await import("../lib/rate-limit.js");

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

const decisions = [];
for (let index = 0; index < 6; index += 1) {
  decisions.push(await rateLimit({ scope: "checkout", identifier: "member@example.com", maximum: 5, windowSeconds: 900 }));
}
check(decisions.slice(0, 5).every((decision) => decision.allowed), "the first five checkout attempts are allowed");
check(!decisions[5].allowed && decisions[5].retryInSeconds > 0, "the sixth checkout attempt is blocked with a retry time");

console.log(`${7} checks`);
if (failures.length) {
  for (const failure of failures) console.error(`FAILED: ${failure}`);
  process.exit(1);
}
console.log("all pass");
