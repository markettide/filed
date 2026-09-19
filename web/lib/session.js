/**
 * Who is signed in, kept in a signed cookie.
 *
 * The cookie carries the reader's identity and an expiry, followed by an HMAC
 * of both. We can therefore tell a cookie we issued from one somebody typed,
 * without storing a single session anywhere - there is no session table to
 * grow, to expire, or to lose when the Redis free tier fills up.
 *
 * Signed, not encrypted. Anyone can read their own cookie and see their own
 * email address in it, which is no secret to them. What they cannot do is
 * change it to somebody else's, because the signature would no longer match
 * and they do not have AUTH_SECRET.
 *
 * httpOnly so page scripts cannot read it, secure so it never crosses plain
 * HTTP, and sameSite=lax so another site cannot cause the browser to send it -
 * which is what stops a link on someone else's page acting as the reader.
 */

import crypto from "node:crypto";

export const COOKIE = "mt_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;   // a month
// Bumping this value invalidates every previously issued login cookie. This
// launch version intentionally requires all readers to sign in again once.
const SESSION_VERSION = process.env.SESSION_VERSION || "premium-trial-2026-09-19";

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function sign(payload) {
  return crypto
    .createHmac("sha256", process.env.AUTH_SECRET)
    .update(payload)
    .digest("base64url");
}

/** A cookie value for this reader, or null if signing in is switched off. */
export function make({ id, channel }) {
  if (!process.env.AUTH_SECRET) return null;
  const body = b64url(
    JSON.stringify({
      id,
      channel,
      ver: SESSION_VERSION,
      exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS,
    })
  );
  return `${body}.${sign(body)}`;
}

/** The reader this cookie belongs to, or null if it is not one of ours. */
export function read(value) {
  if (!value || !process.env.AUTH_SECRET) return null;

  const dot = value.lastIndexOf(".");
  if (dot < 1) return null;

  const body = value.slice(0, dot);
  const given = value.slice(dot + 1);

  const expected = sign(body);
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let data;
  try {
    data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  // The signature proves we wrote it. It does not prove it is still current,
  // and a signed cookie is valid for ever unless something checks the date.
  if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
  if (data.ver !== SESSION_VERSION) return null;

  return { id: data.id, channel: data.channel };
}

/** The Set-Cookie header that signs somebody in. */
export function cookieHeader(value) {
  const parts = [
    `${COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE_SECONDS}`,
  ];
  // Browsers reject Secure cookies on plain http://127.0.0.1. Production is
  // HTTPS, so keep the protection there while allowing local sign-in tests.
  if (process.env.NODE_ENV === "production") parts.splice(3, 0, "Secure");
  return parts.join("; ");
}

/** The Set-Cookie header that signs somebody out. */
export function clearHeader() {
  const parts = [
    `${COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (process.env.NODE_ENV === "production") parts.splice(3, 0, "Secure");
  return parts.join("; ");
}

/** The signed-in reader for a request, or null. */
export function currentUser(request) {
  const raw = request.headers.get("cookie") || "";
  const hit = raw
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`));
  if (!hit) return null;
  return read(hit.slice(COOKIE.length + 1));
}
