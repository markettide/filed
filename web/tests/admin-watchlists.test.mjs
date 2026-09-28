import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { watchlistRows, filterWatchlists } from "../lib/admin-watchlists.js";

const rows = watchlistRows([
  { email: "Empty@example.com" },
  { email: " A@example.com ", portfolio: [{ name: "Fortis Healthcare", ticker: "FORTIS", isin: "IN123", addedAt: new Date("2026-09-28"), secret: "hidden" }],
    telegram: { chatId: 123, username: "@reader", token: "hidden" } },
  { email: "parked@example.com", portfolioOverflow: [{ name: "Reliance" }], alertsEnabled: false },
  { email: "linked@example.com", telegram: { chatId: 456 }, alertsEnabled: false },
  { email: "bad@example.com", portfolio: "invalid", portfolioOverflow: [null] },
]);
assert.equal(rows.length, 3);
assert.equal(rows[0].email, "a@example.com");
assert.equal(rows[0].telegramConnected, true);
assert.equal(rows[0].alertsEnabled, true);
assert.equal(rows[0].telegramUsername, "reader");
assert.equal(rows[0].stocks[0].addedAt, "2026-09-28T00:00:00.000Z");
assert.equal(filterWatchlists(rows, " FORTIS ").length, 1);
assert.equal(filterWatchlists(rows, "in123").length, 1);
assert.equal(filterWatchlists(rows, "reliance")[0].email, "parked@example.com");
assert.equal(filterWatchlists(rows, "reader").length, 1);
assert.equal(filterWatchlists(rows, "missing").length, 0);
assert.equal(filterWatchlists(rows, "").length, 3);
assert.equal(rows.find((row) => row.email === "linked@example.com").alertsEnabled, false);
assert.doesNotMatch(JSON.stringify(rows), /chatId|token|secret|hidden/);
const usersSource = readFileSync(new URL("../lib/users.js", import.meta.url), "utf8");
const adminProjection = usersSource.split("export async function listUsersForAdmin")[1];
for (const field of ["portfolio: 1", "portfolioOverflow: 1", '"telegram.chatId": 1', "alertsEnabled: 1"]) {
  assert.ok(adminProjection.includes(field), `Admin projection includes ${field}`);
}
const route = readFileSync(new URL("../app/api/admin/stats/route.js", import.meta.url), "utf8");
assert.ok(route.indexOf("if (!isAdmin(request))") < route.indexOf("await adminData("));
assert.match(route, /no-store, private/);
console.log("Admin watchlists: all checks pass");
