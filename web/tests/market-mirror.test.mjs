import assert from "node:assert/strict";

const originalUri = process.env.MONGODB_URI;
process.env.MONGODB_URI = "mongodb://example.invalid";

const { marketMirrorEnabled, readMarketMirror } = await import("../lib/market-mirror.js");

assert.equal(
  marketMirrorEnabled(),
  true,
  "MongoDB reads should become primary automatically when MongoDB is configured"
);

assert.deepEqual(
  await readMarketMirror(["SET", "key", "value"]),
  { hit: false, result: null },
  "the read adapter must never execute mutations"
);

if (originalUri === undefined) delete process.env.MONGODB_URI;
else process.env.MONGODB_URI = originalUri;

console.log("MongoDB market storage: all checks pass");
