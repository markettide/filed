import crypto from "node:crypto";

function credentials() {
  return {
    url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
  };
}

function safeKey(scope, identifier) {
  const digest = crypto.createHash("sha256").update(String(identifier)).digest("hex");
  return `mt:limit:${scope}:${digest}`;
}

async function redis(command) {
  const { url, token } = credentials();
  if (!url || !token) throw new Error("Redis rate-limit storage is not configured");
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Redis ${response.status}`);
  return (await response.json()).result;
}

/** Fail-closed distributed limit, shared by all Vercel instances. */
export async function rateLimit({ scope, identifier, maximum, windowSeconds }) {
  const key = safeKey(scope, identifier);
  const count = Number(await redis(["INCR", key]));
  if (count === 1) await redis(["EXPIRE", key, String(windowSeconds)]);
  const ttl = Number(await redis(["TTL", key]));
  return {
    allowed: count <= maximum,
    remaining: Math.max(0, maximum - count),
    retryInSeconds: ttl > 0 ? ttl : windowSeconds,
  };
}
