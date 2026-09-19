import crypto from "node:crypto";
import { MongoClient } from "mongodb";
import { PREMIUM_MONTHS, PREMIUM_PRICE } from "./cashfree";

let clientPromise;
let indexesPromise;

async function collections() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not configured");
  if (!clientPromise) {
    clientPromise = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 6000,
    }).connect().catch((error) => {
      // Do not cache a rejected connection promise. Local DNS and brief Atlas
      // interruptions can recover, and the next checkout should recover too.
      clientPromise = undefined;
      indexesPromise = undefined;
      throw error;
    });
  }
  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || "market_tide");
  const orders = db.collection("payment_orders");
  const users = db.collection("users");
  const webhookEvents = db.collection("payment_webhook_events");
  if (!indexesPromise) {
    indexesPromise = Promise.all([
      orders.createIndex({ orderId: 1 }, { unique: true }),
      orders.createIndex({ cfOrderId: 1 }, { unique: true, sparse: true }),
      orders.createIndex({ email: 1, createdAt: -1 }),
      webhookEvents.createIndex({ eventId: 1 }, { unique: true }),
      webhookEvents.createIndex({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 }),
      users.createIndex({ email: 1 }, { unique: true }),
    ]);
  }
  await indexesPromise;
  return { orders, users, webhookEvents };
}

export function newOrderId() {
  return `mt_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

export async function createPendingOrder({ orderId, email, phone }) {
  const { orders } = await collections();
  const now = new Date();
  await orders.insertOne({
    orderId,
    email,
    phone,
    planId: "premium_3_months",
    amount: PREMIUM_PRICE,
    currency: "INR",
    status: "CREATING",
    createdAt: now,
    updatedAt: now,
  });
}

export async function markOrderCreated(orderId, cashfreeOrder) {
  const { orders } = await collections();
  await orders.updateOne(
    { orderId },
    {
      $set: {
        status: cashfreeOrder.order_status || "ACTIVE",
        cfOrderId: cashfreeOrder.cf_order_id,
        paymentSessionId: cashfreeOrder.payment_session_id,
        updatedAt: new Date(),
      },
    }
  );
}

export async function markOrderCreationFailed(orderId, detail) {
  const { orders } = await collections();
  await orders.updateOne(
    { orderId },
    {
      $set: {
        status: "CREATE_FAILED",
        error: String(detail || "Unknown error").slice(0, 240),
        updatedAt: new Date(),
      },
    }
  );
}

export async function findOrderForUser(orderId, email) {
  const { orders } = await collections();
  return orders.findOne({ orderId, email }, { projection: { _id: 0, paymentSessionId: 0 } });
}

export async function findOrder(orderId) {
  const { orders } = await collections();
  return orders.findOne({ orderId }, { projection: { _id: 0, paymentSessionId: 0 } });
}

function addCalendarMonths(date, months) {
  const result = new Date(date);
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDay));
  return result;
}

export async function activatePaidOrder({ orderId, cfOrderId, cfPaymentId = null, paidAt = null }) {
  const { orders, users } = await collections();
  const order = await orders.findOne({
    orderId,
    amount: PREMIUM_PRICE,
    currency: "INR",
  });
  if (!order) throw new Error("Payment order does not match Market Tide records.");
  if (order.status === "REFUNDED" || order.status === "DISPUTED") {
    const subscription = await users.findOne(
      { email: order.email },
      { projection: { _id: 0, subscriptionPlan: 1, subscriptionStatus: 1, subscriptionEndsAt: 1 } }
    );
    return { order, subscription };
  }

  const now = paidAt ? new Date(paidAt) : new Date();
  await orders.updateOne(
    { orderId },
    {
      $set: {
        status: "PAID",
        cfOrderId: cfOrderId || order.cfOrderId,
        paidAt: now,
        updatedAt: new Date(),
      },
      ...(cfPaymentId ? { $addToSet: { cfPaymentIds: String(cfPaymentId) } } : {}),
    }
  );

  const existing = await users.findOne(
    { email: order.email },
    { projection: { subscriptionEndsAt: 1, premiumOrderIds: 1 } }
  );
  if (!existing?.premiumOrderIds?.includes(orderId)) {
    const currentEnd = existing?.subscriptionEndsAt ? new Date(existing.subscriptionEndsAt) : null;
    const startsFrom = currentEnd && currentEnd > now ? currentEnd : now;
    const endsAt = addCalendarMonths(startsFrom, PREMIUM_MONTHS);
    await users.updateOne(
      { email: order.email, premiumOrderIds: { $ne: orderId } },
      {
        $set: {
          subscriptionPlan: "premium",
          subscriptionStatus: "active",
          subscriptionStartsAt: now,
          subscriptionEndsAt: endsAt,
          latestPaymentOrderId: orderId,
          updatedAt: new Date(),
        },
        $addToSet: { premiumOrderIds: orderId },
        $setOnInsert: { email: order.email, createdAt: new Date() },
      },
      { upsert: !existing }
    );
  }

  const user = await users.findOne(
    { email: order.email },
    { projection: { _id: 0, subscriptionPlan: 1, subscriptionStatus: 1, subscriptionEndsAt: 1 } }
  );
  return { order, subscription: user };
}

export async function markOrderAttempt({ orderId, status, cfPaymentId = null, message = null }) {
  const { orders } = await collections();
  await orders.updateOne(
    { orderId },
    {
      $set: {
        lastPaymentStatus: status,
        ...(message ? { lastPaymentMessage: String(message).slice(0, 240) } : {}),
        updatedAt: new Date(),
      },
      ...(cfPaymentId ? { $addToSet: { cfPaymentIds: String(cfPaymentId) } } : {}),
    }
  );
}

/** Record delivery attempts while keeping the business operation itself safe
 * to repeat. Concurrent deliveries may both run, but activation/refund updates
 * are idempotent and a completed event is skipped on later retries. */
export async function beginWebhookEvent({ eventId, type, orderId }) {
  const { webhookEvents } = await collections();
  const existing = await webhookEvents.findOne({ eventId }, { projection: { status: 1 } });
  if (existing?.status === "COMPLETED") return false;
  const now = new Date();
  await webhookEvents.updateOne(
    { eventId },
    {
      $set: { type, orderId, status: "PROCESSING", updatedAt: now },
      $setOnInsert: { eventId, createdAt: now },
      $inc: { attempts: 1 },
    },
    { upsert: true }
  );
  return true;
}

export async function finishWebhookEvent(eventId, status = "COMPLETED", detail = null) {
  const { webhookEvents } = await collections();
  await webhookEvents.updateOne(
    { eventId },
    {
      $set: {
        status,
        ...(detail ? { detail: String(detail).slice(0, 300) } : {}),
        updatedAt: new Date(),
      },
    }
  );
}

async function rebuildSubscription(email) {
  const { orders, users } = await collections();
  const paidOrders = await orders.find(
    { email, status: "PAID" },
    { projection: { _id: 0, orderId: 1, paidAt: 1 } }
  ).sort({ paidAt: 1, createdAt: 1 }).toArray();

  if (!paidOrders.length) {
    await users.updateOne(
      { email },
      {
        $set: { subscriptionStatus: "refunded", premiumOrderIds: [], updatedAt: new Date() },
        $unset: { subscriptionStartsAt: "", subscriptionEndsAt: "", latestPaymentOrderId: "" },
      }
    );
    return;
  }

  const now = new Date();
  let startsAt = new Date(paidOrders[0].paidAt || now);
  let endsAt = startsAt;
  for (const order of paidOrders) {
    const paidAt = new Date(order.paidAt || startsAt);
    endsAt = addCalendarMonths(endsAt > paidAt ? endsAt : paidAt, PREMIUM_MONTHS);
  }
  await users.updateOne(
    { email },
    {
      $set: {
        subscriptionPlan: "premium",
        subscriptionStatus: endsAt > now ? "active" : "expired",
        subscriptionStartsAt: startsAt,
        subscriptionEndsAt: endsAt,
        premiumOrderIds: paidOrders.map((order) => order.orderId),
        latestPaymentOrderId: paidOrders[paidOrders.length - 1].orderId,
        updatedAt: now,
      },
    }
  );
}

export async function recordRefund({ orderId, refundId, status, amount }) {
  const { orders } = await collections();
  const order = await orders.findOne({ orderId });
  if (!order) return false;
  const normalizedStatus = String(status || "UNKNOWN").toUpperCase();
  const normalizedAmount = Math.max(0, Number(amount) || 0);
  const key = String(refundId || `refund-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, "_");
  await orders.updateOne(
    { orderId },
    {
      $set: {
        [`refunds.${key}`]: { status: normalizedStatus, amount: normalizedAmount, updatedAt: new Date() },
        updatedAt: new Date(),
      },
    }
  );

  if (normalizedStatus === "SUCCESS") {
    const refreshed = await orders.findOne({ orderId }, { projection: { refunds: 1, amount: 1, email: 1 } });
    const refunded = Object.values(refreshed?.refunds || {})
      .filter((entry) => entry.status === "SUCCESS")
      .reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
    if (refunded >= Number(refreshed.amount || PREMIUM_PRICE)) {
      await orders.updateOne(
        { orderId, status: { $ne: "REFUNDED" } },
        { $set: { status: "REFUNDED", refundedAt: new Date(), refundedAmount: refunded, updatedAt: new Date() } }
      );
      await rebuildSubscription(refreshed.email);
    }
  }
  return true;
}

export async function recordDispute({ orderId, dispute }) {
  const { orders } = await collections();
  const disputeId = String(dispute?.dispute_id || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
  const disputeStatus = String(dispute?.dispute_status || "UNKNOWN");
  const adverse = /_(?:MERCHANT_LOST|MERCHANT_ACCEPTED|INSUFFICIENT_EVIDENCE)$/.test(disputeStatus);
  const merchantWon = /_MERCHANT_WON$/.test(disputeStatus);
  const result = await orders.updateOne(
    { orderId },
    {
      $set: {
        [`disputes.${disputeId}`]: {
          status: disputeStatus,
          type: dispute?.dispute_type || null,
          amount: Number(dispute?.dispute_amount) || 0,
          reason: dispute?.reason_description || null,
          actionOn: dispute?.dispute_action_on || null,
          updatedAt: new Date(),
        },
        hasOpenDispute: !/_MERCHANT_WON$/.test(disputeStatus),
        updatedAt: new Date(),
      },
    }
  );
  if (result.matchedCount === 1 && adverse) {
    const order = await orders.findOneAndUpdate(
      { orderId, status: "PAID" },
      { $set: { status: "DISPUTED", disputedAt: new Date(), updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    if (order?.email) await rebuildSubscription(order.email);
  } else if (result.matchedCount === 1 && merchantWon) {
    const order = await orders.findOneAndUpdate(
      { orderId, status: "DISPUTED" },
      { $set: { status: "PAID", updatedAt: new Date() }, $unset: { disputedAt: "" } },
      { returnDocument: "after" }
    );
    if (order?.email) await rebuildSubscription(order.email);
  }
  return result.matchedCount === 1;
}
