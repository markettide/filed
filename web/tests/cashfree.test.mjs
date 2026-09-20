import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.CASHFREE_CLIENT_ID = "TEST_client_id";
process.env.CASHFREE_CLIENT_SECRET = "TEST_secret_key";
process.env.CASHFREE_ENV = "sandbox";

const calls = [];
global.fetch = async (url, init) => {
  calls.push({ url, init });
  return Response.json({
    cf_order_id: "cf_123",
    order_id: "mt_123_abcdef123456",
    order_status: "ACTIVE",
    payment_session_id: "session_123",
  });
};

const cashfree = await import("../lib/cashfree.js");

assert.equal(cashfree.cashfreeConfigured(), true);
assert.equal(cashfree.cashfreeMode(), "sandbox");

await cashfree.createCashfreeOrder({
  orderId: "mt_123_abcdef123456",
  email: "reader@example.com",
  phone: "+919876543210",
  name: "Market Tide Reader",
  appBaseUrl: "http://localhost:3000",
});

assert.equal(calls[0].url, "https://sandbox.cashfree.com/pg/orders");
assert.equal(calls[0].init.headers["x-client-id"], "TEST_client_id");
assert.equal(calls[0].init.headers["x-client-secret"], "TEST_secret_key");
assert.ok(calls[0].init.headers["x-idempotency-key"]);
const order = JSON.parse(calls[0].init.body);
assert.equal(order.order_amount, 299);
assert.equal(order.order_currency, "INR");
assert.equal(order.customer_details.customer_email, "reader@example.com");
assert.equal(order.customer_details.customer_phone, "+919876543210");
assert.equal(order.order_meta.return_url, "http://localhost:3000/payment/return?order_id={order_id}");

const rawBody = JSON.stringify({ data: { order: { order_id: "mt_123" } } });
// Cashfree rejects old webhook timestamps, so keep this safeguard test current.
const timestamp = String(Date.now());
const signature = crypto
  .createHmac("sha256", process.env.CASHFREE_CLIENT_SECRET)
  .update(`${timestamp}${rawBody}`)
  .digest("base64");
assert.equal(cashfree.verifyCashfreeWebhook({ rawBody, timestamp, signature }), true);
assert.equal(cashfree.verifyCashfreeWebhook({ rawBody: `${rawBody} `, timestamp, signature }), false);
assert.equal(cashfree.validPaidOrder({ order_status: "PAID", order_amount: 299, order_currency: "INR" }), true);
assert.equal(cashfree.validPaidOrder({ order_status: "PAID", order_amount: 298, order_currency: "INR" }), false);

console.log("Cashfree payment safeguards: all checks pass");
