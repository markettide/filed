/** Read Market Tide's key/value market snapshot from MongoDB. */

import { MongoClient } from "mongodb";

let clientPromise;
let warned = false;

export function marketMirrorEnabled() {
  return Boolean(process.env.MONGODB_URI);
}

async function collection() {
  if (!clientPromise) {
    const client = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 6000,
    });
    clientPromise = client.connect().catch((error) => {
      clientPromise = undefined;
      throw error;
    });
  }
  const client = await clientPromise;
  return client
    .db(process.env.MONGODB_DB || "market_tide")
    .collection("redis_mirror");
}

/**
 * Return { hit, result }. Missing keys have the same null value they had in
 * the previous store; there is deliberately no external fallback.
 */
export async function readMarketMirror(command) {
  if (!marketMirrorEnabled() || !Array.isArray(command) || !command.length) {
    return { hit: false, result: null };
  }

  const operation = String(command[0]).toUpperCase();
  const keys = operation === "GET"
    ? command.slice(1, 2).map(String)
    : operation === "MGET"
      ? command.slice(1).map(String)
      : [];
  if (!keys.length) return { hit: false, result: null };

  try {
    const rows = await (await collection()).find(
      {
        _id: { $in: keys },
        $or: [
          { expiresAt: { $exists: false } },
          { expiresAt: { $gt: new Date() } },
        ],
      },
      { projection: { value: 1 } }
    ).toArray();
    const values = new Map(rows.map((row) => [row._id, row.value]));
    const result = keys.map((key) => values.has(key) ? values.get(key) : null);
    return { hit: true, result: operation === "GET" ? result[0] : result };
  } catch (error) {
    if (!warned) {
      console.warn("[market-storage] MongoDB read failed:", error.message || error);
      warned = true;
    }
    return { hit: true, result: operation === "GET" ? null : keys.map(() => null) };
  }
}
