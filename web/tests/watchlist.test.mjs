import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { WATCHLIST_LIMITS, limitFor, accessCleanup } = await import("../lib/watchlist.js");

// The watchlist is available to free readers, while trials and paid readers
// get the larger limit. These numbers are the product contract.
assert.equal(limitFor({ premium: false }), WATCHLIST_LIMITS.free);
assert.equal(limitFor({ premium: true }), WATCHLIST_LIMITS.premium);
assert.equal(WATCHLIST_LIMITS.free, 5);
assert.equal(WATCHLIST_LIMITS.premium, 50);

const companies51 = Array.from({ length: 51 }, (_, index) => ({
  isin: `IN${index}`, name: `Company ${index}`, addedAt: new Date(2026, 0, index + 1),
}));
const downgrade = accessCleanup({
  portfolio: companies51,
  portfolioOverflow: [{ isin: "OLD", name: "Old parked company" }],
  telegram: { chatId: 123 },
  alertsEnabled: true,
}, WATCHLIST_LIMITS.free);
assert.equal(downgrade.stocks.length, 5);
assert.deepEqual(downgrade.stocks, companies51.slice(0, 5), "the oldest five survive");
assert.equal(downgrade.removed, 47);
assert.equal(downgrade.parked, 0);
assert.equal(downgrade.disconnected, true);
assert.equal(downgrade.update.$set.alertsEnabled, false);
assert.equal(downgrade.update.$unset.telegram, "");
assert.equal(downgrade.update.$unset.portfolioOverflow, "");

const trialOrPaid = accessCleanup({ portfolio: companies51 }, WATCHLIST_LIMITS.premium);
assert.equal(trialOrPaid.stocks.length, 50);
assert.equal(trialOrPaid.removed, 1);
assert.equal(trialOrPaid.disconnected, false);

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

// Keep every entry point aligned: page/API writes, old Telegram deep links,
// and the scheduled alert run must all apply the same expiry policy.
const watchlistRoute = await readFile(new URL("../app/api/watchlist/route.js", import.meta.url), "utf8");
assert.ok(watchlistRoute.match(/await enforceLimit\(email, limit\);[\s\S]*await addToWatchlist/));
const webhookRoute = await readFile(new URL("../app/api/telegram/webhook/route.js", import.meta.url), "utf8");
assert.ok(webhookRoute.includes("if (!accessForProfile(profile).premium)"));
const alertsRoute = await readFile(new URL("../app/api/cron/alerts/route.js", import.meta.url), "utf8");
assert.ok(alertsRoute.includes("await cleanupExpiredPremiumBenefits()"));

console.log("MongoDB watchlist contract: all checks pass");
