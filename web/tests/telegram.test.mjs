import assert from "node:assert/strict";

const { newTelegramLinkToken } = await import("../lib/operational-state.js");
const { formatFiling } = await import("../lib/telegram.js");

// Telegram permits only A-Z, a-z, 0-9, underscore and hyphen in /start
// parameters, with a hard 64-character limit.
const token = newTelegramLinkToken();
assert.equal(token.length, 32);
assert.match(token, /^[A-Za-z0-9_-]+$/);
assert.ok(token.length <= 64);
assert.notEqual(token, newTelegramLinkToken());

const message = formatFiling(
  {
    company: "Example & Sons",
    tag: "Results <Q2>",
    time: "12:30",
    summary: "Profit > last year",
    key_numbers: ["Revenue ₹100 cr"],
    pdf_url: "https://example.test/filing.pdf?a=1&b=2",
  },
  { name: "Example & Sons" }
);
assert.match(message, /Example &amp; Sons/);
assert.match(message, /Results &lt;Q2&gt;/);
assert.match(message, /Profit &gt; last year/);
assert.match(message, /Read the filing/);
assert.doesNotMatch(message, /<Q2>/);

console.log("Telegram watchlist integration: all checks pass");
