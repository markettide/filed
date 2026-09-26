import assert from "node:assert/strict";
import { briefWorkerToken, isBriefWorker } from "../lib/brief-worker-auth.js";

const originalKv = process.env.KV_REST_API_TOKEN;
const originalUpstash = process.env.UPSTASH_REDIS_REST_TOKEN;
const originalWorker = process.env.BRIEF_WORKER_SECRET;
const originalMongo = process.env.MONGODB_URI;

try {
  process.env.BRIEF_WORKER_SECRET = "test-shared-secret";
  delete process.env.MONGODB_URI;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;

  const token = briefWorkerToken();
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(token, briefWorkerToken("test-shared-secret"));
  assert.notEqual(token, briefWorkerToken("different-secret"));

  const request = (value) => new Request("https://example.test/api/announcements", {
    headers: value ? { "x-brief-worker": value } : {},
  });
  assert.equal(isBriefWorker(request(token)), true);
  assert.equal(isBriefWorker(request("0".repeat(64))), false);
  assert.equal(isBriefWorker(request("short")), false);
  assert.equal(isBriefWorker(request(null)), false);

  delete process.env.BRIEF_WORKER_SECRET;
  assert.equal(briefWorkerToken(), "");
  assert.equal(isBriefWorker(request(token)), false);

  console.log("6 checks\nall pass");
} finally {
  if (originalKv === undefined) delete process.env.KV_REST_API_TOKEN;
  else process.env.KV_REST_API_TOKEN = originalKv;
  if (originalUpstash === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
  else process.env.UPSTASH_REDIS_REST_TOKEN = originalUpstash;
  if (originalWorker === undefined) delete process.env.BRIEF_WORKER_SECRET;
  else process.env.BRIEF_WORKER_SECRET = originalWorker;
  if (originalMongo === undefined) delete process.env.MONGODB_URI;
  else process.env.MONGODB_URI = originalMongo;
}
