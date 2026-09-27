import assert from "node:assert/strict";

const { newTelegramLinkToken } = await import("../lib/operational-state.js");
process.env.TELEGRAM_BOT_NAME = "@@Markettide_bot";
process.env.TELEGRAM_BOT_TOKEN = "123456:test-token";
const { botName, formatFiling, verifyLoginPayload } = await import("../lib/telegram.js");

assert.equal(botName(), "Markettide_bot");

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

const { createHash, createHmac } = await import("node:crypto");
const authDate = Math.floor(Date.now() / 1000);
const login = {
  id: "123456789",
  first_name: "Test",
  username: "market_reader",
  auth_date: authDate,
};
const checkString = Object.entries(login)
  .map(([key, value]) => `${key}=${value}`)
  .sort()
  .join("\n");
const secret = createHash("sha256").update(process.env.TELEGRAM_BOT_TOKEN).digest();
login.hash = createHmac("sha256", secret).update(checkString).digest("hex");
assert.deepEqual(verifyLoginPayload(login), {
  chatId: "123456789",
  username: "market_reader",
  firstName: "Test",
  lastName: null,
});
assert.equal(verifyLoginPayload({ ...login, id: "987654321" }), null);
assert.equal(
  verifyLoginPayload({ ...login, auth_date: authDate - 601 }),
  null
);

console.log("Telegram watchlist integration: all checks pass");
