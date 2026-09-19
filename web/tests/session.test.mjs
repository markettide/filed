import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.AUTH_SECRET = "test-secret-that-is-long-enough-for-session-tests";

const session = await import("../lib/session.js");
const token = session.make({ id: "email:reader@example.com", channel: "email" });
assert.ok(token);
assert.deepEqual(session.read(token), {
  id: "email:reader@example.com",
  channel: "email",
});

// A correctly signed cookie from the pre-versioned release must still be
// rejected, which is what signs every existing account out at deployment.
const oldBody = Buffer.from(JSON.stringify({
  id: "email:reader@example.com",
  channel: "email",
  exp: Math.floor(Date.now() / 1000) + 3600,
})).toString("base64url");
const oldSignature = crypto
  .createHmac("sha256", process.env.AUTH_SECRET)
  .update(oldBody)
  .digest("base64url");
assert.equal(session.read(`${oldBody}.${oldSignature}`), null);

console.log("Session invalidation tests passed.");
