/** Small, expiring operational records that used to live in Redis. */

import crypto from "node:crypto";
import { MongoClient } from "mongodb";

let clientPromise;
let indexesPromise;

async function collections() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not configured");
  if (!clientPromise) {
    clientPromise = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 6000,
    }).connect().catch((error) => {
      clientPromise = undefined;
      indexesPromise = undefined;
      throw error;
    });
  }
  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || "market_tide");
  const limits = db.collection("rate_limits");
  const broadcasts = db.collection("brief_broadcasts");
  if (!indexesPromise) {
    indexesPromise = Promise.all([
      limits.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      broadcasts.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]);
  }
  await indexesPromise;
  return { limits, broadcasts };
}

function limitId(scope, identifier) {
  const digest = crypto.createHash("sha256").update(String(identifier)).digest("hex");
  return `${scope}:${digest}`;
}

/** Atomic fixed-window limit shared by every Vercel instance. */
export async function rateLimit({ scope, identifier, maximum, windowSeconds }) {
  const { limits } = await collections();
  const now = new Date();
  const nextExpiry = new Date(now.getTime() + windowSeconds * 1000);
  const result = await limits.findOneAndUpdate(
    { _id: limitId(scope, identifier) },
    [
      {
        $set: {
          count: {
            $cond: [
              { $gt: ["$expiresAt", now] },
              { $add: [{ $ifNull: ["$count", 0] }, 1] },
              1,
            ],
          },
          expiresAt: {
            $cond: [{ $gt: ["$expiresAt", now] }, "$expiresAt", nextExpiry],
          },
          updatedAt: now,
        },
      },
    ],
    { upsert: true, returnDocument: "after" }
  );
  const record = result || { count: 1, expiresAt: nextExpiry };
  const retryInSeconds = Math.max(
    1,
    Math.ceil((new Date(record.expiresAt).getTime() - now.getTime()) / 1000)
  );
  return {
    allowed: Number(record.count) <= maximum,
    remaining: Math.max(0, maximum - Number(record.count)),
    retryInSeconds,
  };
}

export async function clearRateLimit(scope, identifier) {
  const { limits } = await collections();
  await limits.deleteOne({ _id: limitId(scope, identifier) });
}

export async function claimBriefBroadcast(day, ttlSeconds = 600) {
  const { broadcasts } = await collections();
  const now = new Date();
  try {
    await broadcasts.insertOne({
      _id: day,
      state: "creating",
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
    });
    return { claimed: true, record: null };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    return { claimed: false, record: await broadcasts.findOne({ _id: day }) };
  }
}

export async function completeBriefBroadcast(day, broadcast, ttlSeconds) {
  const { broadcasts } = await collections();
  const now = new Date();
  await broadcasts.updateOne(
    { _id: day },
    {
      $set: {
        state: "scheduled",
        broadcast,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
      },
    }
  );
}

export async function releaseBriefBroadcast(day) {
  const { broadcasts } = await collections();
  await broadcasts.deleteOne({ _id: day, state: "creating" });
}
