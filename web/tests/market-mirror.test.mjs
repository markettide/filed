import assert from "node:assert/strict";

const original = process.env.MONGO_MARKET_READS;
delete process.env.MONGO_MARKET_READS;

const { readMarketMirror } = await import("../lib/market-mirror.js");

assert.deepEqual(
  await readMarketMirror(["GET", "mt:index"]),
  { hit: false, result: null },
  "MongoDB reads must remain disabled until the migration switch is explicit"
);
assert.deepEqual(
  await readMarketMirror(["SET", "key", "value"]),
  { hit: false, result: null },
  "the read adapter must never execute mutations"
);

if (original === undefined) delete process.env.MONGO_MARKET_READS;
else process.env.MONGO_MARKET_READS = original;

console.log("MongoDB market mirror gate: all checks pass");
