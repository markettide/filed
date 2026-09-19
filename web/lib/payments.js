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
  if (!indexesPromise) {
    indexesPromise = Promise.all([
      orders.createIndex({ orderId: 1 }, { unique: true }),
      orders.createIndex({ cfOrderId: 1 }, { unique: true, sparse: true }),
      orders.createIndex({ email: 1, createdAt: -1 }),
      users.createIndex({ email: 1 }, { unique: true }),
    ]);
  }
  await indexesPromise;
  return { orders, users };
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
