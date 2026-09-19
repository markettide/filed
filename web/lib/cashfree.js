import crypto from "node:crypto";

export const CASHFREE_API_VERSION = process.env.CASHFREE_API_VERSION || "2025-01-01";
export const PREMIUM_PRICE = 299;
export const PREMIUM_MONTHS = 3;

function environment() {
  return process.env.CASHFREE_ENV === "production" ? "production" : "sandbox";
}

function baseUrl() {
  return environment() === "production"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";
}

export function cashfreeConfigured() {
  return Boolean(process.env.CASHFREE_CLIENT_ID && process.env.CASHFREE_CLIENT_SECRET);
}

export function cashfreeMode() {
  return environment();
}

function headers(idempotencyKey) {
  const result = {
    "content-type": "application/json",
    "x-api-version": CASHFREE_API_VERSION,
    "x-client-id": process.env.CASHFREE_CLIENT_ID,
    "x-client-secret": process.env.CASHFREE_CLIENT_SECRET,
  };
  if (idempotencyKey) result["x-idempotency-key"] = idempotencyKey;
  return result;
}

async function cashfreeRequest(path, init = {}) {
  if (!cashfreeConfigured()) throw new Error("Cashfree test keys are not configured.");

  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { ...headers(init.idempotencyKey), ...(init.headers || {}) },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.type || "Cashfree rejected the request.");
    error.status = response.status;
    error.code = data.code || data.type || "cashfree_error";
    throw error;
  }
  return data;
}

export async function createCashfreeOrder({ orderId, email, phone, name, appBaseUrl }) {
  return cashfreeRequest("/orders", {
    method: "POST",
    idempotencyKey: crypto.randomUUID(),
    body: JSON.stringify({
      order_id: orderId,
      order_amount: PREMIUM_PRICE,
      order_currency: "INR",
      customer_details: {
        customer_id: `mt_${crypto.createHash("sha256").update(email).digest("hex").slice(0, 24)}`,
        customer_email: email,
        customer_phone: phone,
        ...(name ? { customer_name: name } : {}),
      },
      order_meta: {
        return_url: `${appBaseUrl}/payment/return?order_id={order_id}`,
        notify_url: `${appBaseUrl}/api/payments/webhook`,
      },
      order_note: "Market Tide Premium access for three months",
      order_tags: { plan_id: "premium_3_months" },
    }),
  });
}

export async function getCashfreeOrder(orderId) {
  return cashfreeRequest(`/orders/${encodeURIComponent(orderId)}`, { method: "GET" });
}

export function webhookTimestampIsFresh(timestamp, now = Date.now(), windowMs = 5 * 60 * 1000) {
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric) || numeric <= 0) return false;
  const timestampMs = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  return Math.abs(now - timestampMs) <= windowMs;
}

export function verifyCashfreeWebhook({ rawBody, signature, timestamp, now = Date.now() }) {
  if (!cashfreeConfigured() || !rawBody || !signature || !timestamp) return false;
  if (!webhookTimestampIsFresh(timestamp, now)) return false;
  const expected = crypto
    .createHmac("sha256", process.env.CASHFREE_CLIENT_SECRET)
    .update(`${timestamp}${rawBody}`)
    .digest("base64");
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(String(signature));
  return expectedBuffer.length === signatureBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
}

export function validPaidOrder(order) {
  return order?.order_status === "PAID"
    && Number(order?.order_amount) === PREMIUM_PRICE
    && order?.order_currency === "INR";
}
