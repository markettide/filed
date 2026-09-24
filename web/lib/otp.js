/** Secure, short-lived email OTPs backed by MongoDB. */

import crypto from "node:crypto";
import { MongoClient } from "mongodb";

const CODE_TTL_SECONDS = 10 * 60;
const MAX_ATTEMPTS = 5;
const MAX_SENDS = 3;
const SEND_WINDOW_SECONDS = 15 * 60;

let clientPromise;
let collectionsPromise;
let testStore;

export function configured() {
  return Boolean(process.env.MONGODB_URI && process.env.AUTH_SECRET);
}

export function missing() {
  const gaps = [];
  if (!process.env.MONGODB_URI) gaps.push("MONGODB_URI");
  if (!process.env.AUTH_SECRET) gaps.push("AUTH_SECRET");
  return gaps;
}

async function collections() {
  if (!configured()) throw new Error(`OTP storage is not configured: ${missing().join(", ")}`);
  if (!clientPromise) {
    const client = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 6000,
    });
    clientPromise = client.connect().catch((error) => {
      clientPromise = undefined;
      collectionsPromise = undefined;
      throw error;
    });
  }
  if (!collectionsPromise) {
    collectionsPromise = clientPromise.then(async (client) => {
      const db = client.db(process.env.MONGODB_DB || "market_tide");
      const codes = db.collection("auth_otps");
      const limits = db.collection("auth_otp_limits");
      await Promise.all([
        codes.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        limits.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      ]);
      return { codes, limits };
    }).catch((error) => {
      collectionsPromise = undefined;
      throw error;
    });
  }
  return collectionsPromise;
}

function unwrap(result) {
  return result?.value === undefined ? result : result.value;
}

const mongoStore = {
  async consumeSendSlot(identifier, now) {
    const { limits } = await collections();
    const active = unwrap(await limits.findOneAndUpdate(
      { _id: identifier, expiresAt: { $gt: now }, count: { $lt: MAX_SENDS } },
      { $inc: { count: 1 } },
      { returnDocument: "after" }
    ));
    if (active) {
      return {
        allowed: true,
        retryInSeconds: Math.max(1, Math.ceil((active.expiresAt.getTime() - now.getTime()) / 1000)),
      };
    }

    const expiresAt = new Date(now.getTime() + SEND_WINDOW_SECONDS * 1000);
    try {
      const fresh = unwrap(await limits.findOneAndUpdate(
        {
          _id: identifier,
          $or: [
            { expiresAt: { $lte: now } },
            { expiresAt: { $exists: false } },
          ],
        },
        { $set: { count: 1, expiresAt } },
        { upsert: true, returnDocument: "after" }
      ));
      if (fresh) return { allowed: true, retryInSeconds: SEND_WINDOW_SECONDS };
    } catch (error) {
      // An active, exhausted row does not match the upsert filter. Mongo then
      // reports the existing _id as a duplicate; that simply means "limited".
      if (error?.code !== 11000) throw error;
    }

    const current = await limits.findOne({ _id: identifier });
    const retryInSeconds = current?.expiresAt
      ? Math.max(1, Math.ceil((current.expiresAt.getTime() - now.getTime()) / 1000))
      : SEND_WINDOW_SECONDS;
    return { allowed: false, retryInSeconds };
  },

  async saveCode(identifier, record) {
    const { codes } = await collections();
    await codes.updateOne({ _id: identifier }, { $set: record }, { upsert: true });
  },

  async consumeCorrectCode(identifier, codeHash, now) {
    const { codes } = await collections();
    return unwrap(await codes.findOneAndDelete({
      _id: identifier,
      codeHash,
      expiresAt: { $gt: now },
    }));
  },

  async recordWrongAttempt(identifier, now) {
    const { codes } = await collections();
    const updated = unwrap(await codes.findOneAndUpdate(
      { _id: identifier, expiresAt: { $gt: now }, attempts: { $lt: MAX_ATTEMPTS - 1 } },
      { $inc: { attempts: 1 } },
      { returnDocument: "after" }
    ));
    if (updated) return { exists: true, burned: false, attempts: updated.attempts };

    const current = await codes.findOne({ _id: identifier, expiresAt: { $gt: now } });
    if (!current) return { exists: false, burned: false, attempts: 0 };
    await codes.deleteOne({ _id: identifier });
    return { exists: true, burned: true, attempts: MAX_ATTEMPTS };
  },

  async clearLimit(identifier) {
    const { limits } = await collections();
    await limits.deleteOne({ _id: identifier });
  },
};

function store() {
  return testStore || mongoStore;
}

/** Test-only dependency injection; never used by application routes. */
export function setOtpStoreForTests(value) {
  if (process.env.NODE_ENV !== "test") throw new Error("OTP test store is only available in tests");
  testStore = value;
}

function newCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function hash(identifier, code) {
  return crypto
    .createHmac("sha256", process.env.AUTH_SECRET)
    .update(`${identifier}:${code}`)
    .digest("hex");
}

export async function issue(identifier, metadata = {}) {
  if (!configured()) return { ok: false, reason: "not_configured", missing: missing() };

  const now = new Date();
  const slot = await store().consumeSendSlot(identifier, now);
  if (!slot.allowed) {
    return {
      ok: false,
      reason: "too_many",
      retryInSeconds: slot.retryInSeconds || SEND_WINDOW_SECONDS,
    };
  }

  const code = newCode();
  await store().saveCode(identifier, {
    codeHash: hash(identifier, code),
    attempts: 0,
    metadata,
    createdAt: now,
    expiresAt: new Date(now.getTime() + CODE_TTL_SECONDS * 1000),
  });
  return { ok: true, code, expiresInSeconds: CODE_TTL_SECONDS };
}

export async function check(identifier, code) {
  if (!configured()) return { ok: false, reason: "not_configured", missing: missing() };
  if (!/^\d{6}$/.test(String(code || ""))) return { ok: false, reason: "bad_code" };

  const now = new Date();
  const correct = await store().consumeCorrectCode(identifier, hash(identifier, code), now);
  if (correct) {
    await store().clearLimit(identifier);
    return { ok: true, metadata: correct.metadata || {} };
  }

  const wrong = await store().recordWrongAttempt(identifier, now);
  if (wrong.burned) return { ok: false, reason: "too_many_attempts" };
  return {
    ok: false,
    reason: "bad_code",
    ...(wrong.exists ? { attemptsLeft: MAX_ATTEMPTS - wrong.attempts } : {}),
  };
}
