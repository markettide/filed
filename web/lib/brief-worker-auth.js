import crypto from "node:crypto";

const PURPOSE = "market-tide-brief-worker-v1";
const HEADER = "x-brief-worker";

function sharedSecret() {
  return process.env.BRIEF_WORKER_SECRET
    || process.env.MONGODB_URI
    || process.env.KV_REST_API_TOKEN
    || process.env.UPSTASH_REDIS_REST_TOKEN
    || "";
}

export function briefWorkerToken(secret = sharedSecret()) {
  if (!secret) return "";
  return crypto.createHmac("sha256", secret).update(PURPOSE).digest("hex");
}

export function isBriefWorker(request) {
  const expected = briefWorkerToken();
  const supplied = String(request.headers.get(HEADER) || "");
  if (!expected || !supplied) return false;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const suppliedBuffer = Buffer.from(supplied, "utf8");
  return expectedBuffer.length === suppliedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}
