/**
 * Tests for signing in.
 *
 * This is the one part of the site where a bug is not a wrong category on a
 * page - it is somebody reading as somebody else. So the things being checked
 * here are the attacks, not the happy path: a forged cookie, a replayed code,
 * a stale session, brute force.
 *
 *   node web/tests/auth.test.mjs
 *
 * MongoDB OTP storage is replaced by an in-memory stand-in, so this needs no
 * network, credentials or cleanup.
 */

import crypto from "node:crypto";

process.env.NODE_ENV = "production";
process.env.AUTH_SECRET = "test-secret-not-a-real-one";
process.env.MONGODB_URI = "mongodb://unused.invalid/test";

// ------------------------------------------------------------ fake OTP store

const codes = new Map();
const limits = new Map();
const store = {
  clear() {
    codes.clear();
    limits.clear();
  },
  async consumeSendSlot(identifier, now) {
    let row = limits.get(identifier);
    if (row && row.expiresAt <= now) {
      limits.delete(identifier);
      row = null;
    }
    if (row?.count >= 3) {
      return {
        allowed: false,
        retryInSeconds: Math.ceil((row.expiresAt.getTime() - now.getTime()) / 1000),
      };
    }
    if (row) row.count += 1;
    else limits.set(identifier, { count: 1, expiresAt: new Date(now.getTime() + 15 * 60 * 1000) });
    return { allowed: true, retryInSeconds: 15 * 60 };
  },
  async saveCode(identifier, record) {
    codes.set(identifier, { ...record });
  },
  async consumeCorrectCode(identifier, codeHash, now) {
    const row = codes.get(identifier);
    if (!row || row.expiresAt <= now || row.codeHash !== codeHash) return null;
    codes.delete(identifier);
    return row;
  },
  async recordWrongAttempt(identifier, now) {
    const row = codes.get(identifier);
    if (!row || row.expiresAt <= now) return { exists: false, burned: false, attempts: 0 };
    row.attempts += 1;
    if (row.attempts >= 5) {
      codes.delete(identifier);
      return { exists: true, burned: true, attempts: 5 };
    }
    return { exists: true, burned: false, attempts: row.attempts };
  },
  async clearLimit(identifier) {
    limits.delete(identifier);
  },
};

// ------------------------------------------------------------ harness

let pass = 0;
const failures = [];
function check(condition, what, detail = "") {
  if (condition) pass += 1;
  else failures.push(detail ? `${what}\n      ${detail}` : what);
}

const session = await import("../lib/session.js");
const otp = await import("../lib/otp.js");
const readiness = await import("../lib/auth-ready.js");
process.env.NODE_ENV = "test";
otp.setOtpStoreForTests(store);
process.env.NODE_ENV = "production";

// The public pages must not be accidentally locked while production setup is
// incomplete. The gate activates only when all four services are present.
delete process.env.MONGODB_URI;
delete process.env.RESEND_API_KEY;
check(readiness.authReady() === false,
      "member access stays off while MongoDB or email delivery is missing");
process.env.MONGODB_URI = "mongodb://unused.invalid/test";
process.env.RESEND_API_KEY = "re_test_key";
check(readiness.authReady() === true,
      "member access turns on when storage, delivery and signing are configured");

// ------------------------------------------------------------ 1. the cookie

const cookie = session.make({ id: "email:ishan@example.com", channel: "email" });
check(
  session.read(cookie)?.id === "email:ishan@example.com",
  "a cookie we issued reads back as the person we issued it to"
);

// Swap the identity, keep the signature. This is the attack the signature
// exists to stop: without it, anybody could edit their own cookie and become
// anybody else.
const [body, sig] = cookie.split(".");
const forged = Buffer.from(
  JSON.stringify({
    id: "email:someone-else@example.com",
    channel: "email",
    exp: Math.floor(Date.now() / 1000) + 999,
  })
).toString("base64url");
check(session.read(`${forged}.${sig}`) === null,
      "a swapped identity with a borrowed signature is refused");
check(session.read(`${body}.${sig.slice(0, -1)}x`) === null,
      "a signature with one character changed is refused");
check(session.read("garbage") === null, "nonsense is refused");
check(session.read("") === null, "an empty cookie is refused");

// Correctly signed, but old. The signature proves we wrote it; only the date
// proves it is still current, and a signed cookie with nothing checking the
// date is valid for ever.
const stale = Buffer.from(
  JSON.stringify({
    id: "email:a@b.com",
    channel: "email",
    exp: Math.floor(Date.now() / 1000) - 1,
  })
).toString("base64url");
const staleSig = crypto
  .createHmac("sha256", process.env.AUTH_SECRET)
  .update(stale)
  .digest("base64url");
check(session.read(`${stale}.${staleSig}`) === null,
      "an expired cookie is refused even though the signature is genuine");

process.env.AUTH_SECRET = "a-different-secret";
check(session.read(cookie) === null,
      "a cookie signed with a different secret is refused");
process.env.AUTH_SECRET = "test-secret-not-a-real-one";

const header = session.cookieHeader(cookie);
for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) {
  check(header.includes(flag), `the cookie is set with ${flag}`);
}
check(session.clearHeader().includes("Max-Age=0"),
      "signing out expires the cookie");

process.env.NODE_ENV = "development";
check(!session.cookieHeader(cookie).includes("Secure"),
      "the local HTTP cookie is not marked Secure");
check(!session.clearHeader().includes("Secure"),
      "the local logout cookie is not marked Secure");
process.env.NODE_ENV = "production";

// ------------------------------------------------------------ 2. the code

const who = "email:reader@example.com";

const first = await otp.issue(who);
check(first.ok && /^\d{6}$/.test(first.code),
      "issuing gives a six-digit code", JSON.stringify(first));

check((await otp.check(who, "000000")).ok === false || first.code === "000000",
      "a guessed code does not work");

// The real code, on a fresh issue.
store.clear();
const good = await otp.issue(who);
check((await otp.check(who, good.code)).ok === true,
      "the code we sent does work");

// Registration details travel with the one-time code in server-side storage,
// rather than trusting a phone number submitted again at verification time.
store.clear();
const withProfile = await otp.issue(who, { phone: "+919876543210" });
const profileVerdict = await otp.check(who, withProfile.code);
check(profileVerdict.metadata?.phone === "+919876543210",
      "the verified code returns its server-side registration details");

// ...and only once. Somebody who reads the code over a shoulder, or out of a
// forwarded email, must not be able to use it after the owner has.
check((await otp.check(who, good.code)).ok === false,
      "the same code cannot be used twice");

// Five wrong guesses destroys it. Six digits is a million possibilities, which
// sounds like plenty until you realise a script can try them all in an hour.
store.clear();
const target = await otp.issue(who);
const wrong = target.code === "111111" ? "222222" : "111111";
let lastReason = "";
for (let i = 0; i < 5; i += 1) {
  lastReason = (await otp.check(who, wrong)).reason;
}
check(lastReason === "too_many_attempts",
      "five wrong guesses burns the code", `got ${lastReason}`);
check((await otp.check(who, target.code)).ok === false,
      "the real code no longer works after the guesses burnt it");

// Three codes per quarter of an hour, so nobody can be woken at 3am by a
// stranger typing their number, and our own message bill cannot be run up.
store.clear();
const asks = [];
for (let i = 0; i < 4; i += 1) asks.push(await otp.issue(who));
check(asks.slice(0, 3).every((a) => a.ok), "three codes in a row are allowed");
check(asks[3].ok === false && asks[3].reason === "too_many",
      "a fourth is refused", JSON.stringify(asks[3]));

// Two people asking at the same time do not share a limit or a code.
store.clear();
const a = await otp.issue("email:one@example.com");
const b = await otp.issue("email:two@example.com");
check(a.ok && b.ok, "two different people can both be sent a code");
check((await otp.check("email:one@example.com", b.code)).ok === false ||
      a.code === b.code,
      "one person's code does not sign in another");

// The stored value must not be the code. If it were, anyone who could read the
// database could sign in as anyone.
store.clear();
const secret = await otp.issue(who);
const saved = JSON.stringify(codes.get(who) || {});
check(!saved.includes(secret.code),
      "the code itself is never written down", saved.slice(0, 80));

// No secret means no sign-in, rather than a guessable default.
const realSecret = process.env.AUTH_SECRET;
delete process.env.AUTH_SECRET;
check(otp.configured() === false, "without AUTH_SECRET, sign-in reports itself off");
check((await otp.issue(who)).reason === "not_configured",
      "without AUTH_SECRET, no code is issued");
check(session.make({ id: "x", channel: "email" }) === null,
      "without AUTH_SECRET, no session is issued");
process.env.AUTH_SECRET = realSecret;

// ------------------------------------------------------------ result

console.log(`${pass + failures.length} checks`);
if (failures.length) {
  console.log(`\n${failures.length} FAILED\n`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("all pass");
