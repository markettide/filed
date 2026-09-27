import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { WATCHLIST_LIMITS, limitFor } = await import("../lib/watchlist.js");

// The watchlist is available to free readers, while trials and paid readers
// get the larger limit. These numbers are the product contract.
assert.equal(limitFor({ premium: false }), WATCHLIST_LIMITS.free);
assert.equal(limitFor({ premium: true }), WATCHLIST_LIMITS.premium);
assert.equal(WATCHLIST_LIMITS.free, 5);
assert.equal(WATCHLIST_LIMITS.premium, 50);

// The committed company catalogue is the trusted source used by the add
// endpoint. Check its rows contain every field MongoDB watchlists and filing
// matching rely on. Reading it directly keeps this test compatible with
// Node's strict JSON-module rules as well as Next's bundler.
const companies = JSON.parse(
  await readFile(new URL("../data/companies.json", import.meta.url), "utf8")
);
assert.ok(companies.length > 1000, "the listed-company catalogue should be populated");
const reliance = companies.find((row) => /reliance industries/i.test(row.name));
assert.ok(reliance, "Reliance should be present in the company catalogue");
for (const field of ["isin", "name", "ticker", "key"]) {
  assert.ok(reliance[field], `company rows need ${field} for watchlist storage`);
}

console.log("MongoDB watchlist contract: all checks pass");
