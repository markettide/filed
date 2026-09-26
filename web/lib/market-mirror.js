/** Read the exact Redis-compatible market snapshot copied into MongoDB. */

import { MongoClient } from "mongodb";

let clientPromise;
let warned = false;

export function marketMirrorEnabled() {
  return process.env.MONGO_MARKET_READS === "1" && Boolean(process.env.MONGODB_URI);
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
 * Return { hit, result }. A partial or expired MongoDB result is a miss, so
 * callers can safely execute the original Redis command instead.
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
    if (!keys.every((key) => values.has(key))) return { hit: false, result: null };
    const result = keys.map((key) => values.get(key));
    return { hit: true, result: operation === "GET" ? result[0] : result };
  } catch (error) {
    if (!warned) {
      console.warn("[market-mirror] MongoDB read failed; using Redis fallback:", error.message || error);
      warned = true;
    }
    return { hit: false, result: null };
  }
}
