import assert from "node:assert/strict";

const { clearServerCache, withServerCache } = await import("../lib/server-cache.js");

clearServerCache();
let loads = 0;
const load = async () => {
  loads += 1;
  return { value: loads };
};

const [first, concurrent] = await Promise.all([
  withServerCache("market", 1000, load),
  withServerCache("market", 1000, load),
]);
assert.deepEqual(first, { value: 1 });
assert.deepEqual(concurrent, { value: 1 });
assert.equal(loads, 1, "simultaneous misses should share one upstream read");

const cached = await withServerCache("market", 1000, load);
assert.deepEqual(cached, { value: 1 });
assert.equal(loads, 1, "a live entry should not reload");

clearServerCache();
let failures = 0;
await assert.rejects(() => withServerCache("failure", 1000, async () => {
  failures += 1;
  throw new Error("temporary upstream failure");
}));
await assert.rejects(() => withServerCache("failure", 1000, async () => {
  failures += 1;
  throw new Error("temporary upstream failure");
}));
assert.equal(failures, 2, "failures must never become cached data");

console.log("Server market-data cache: all checks pass");
