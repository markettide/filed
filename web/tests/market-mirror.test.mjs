import assert from "node:assert/strict";

const original = process.env.MONGO_MARKET_READS;
const originalUri = process.env.MONGODB_URI;
process.env.MONGODB_URI = "mongodb://example.invalid";
delete process.env.MONGO_MARKET_READS;

const { marketMirrorEnabled, readMarketMirror } = await import("../lib/market-mirror.js");

assert.equal(
  marketMirrorEnabled(),
  true,
  "MongoDB reads should become primary automatically when MongoDB is configured"
);

process.env.MONGO_MARKET_READS = "0";

assert.deepEqual(
  await readMarketMirror(["GET", "mt:index"]),
  { hit: false, result: null },
  "an explicit zero must keep the Redis-only rollback available"
);

process.env.MONGO_MARKET_READS = "1";
assert.deepEqual(
  await readMarketMirror(["SET", "key", "value"]),
  { hit: false, result: null },
  "the read adapter must never execute mutations"
);

if (original === undefined) delete process.env.MONGO_MARKET_READS;
else process.env.MONGO_MARKET_READS = original;
if (originalUri === undefined) delete process.env.MONGODB_URI;
else process.env.MONGODB_URI = originalUri;

console.log("MongoDB market mirror cut-over: all checks pass");
