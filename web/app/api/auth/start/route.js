/** Start a secure email OTP sign-in.
 * New reader: email -> phone -> OTP. Returning reader: email -> OTP.
 */

import { normalisePhone } from "../../../../lib/phone";
import { authReady } from "../../../../lib/auth-ready";
import { issue } from "../../../../lib/otp";
import { findByEmail } from "../../../../lib/users";
import { sendEmailCode } from "../../../../lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function tidyEmail(raw) {
  const email = String(raw || "").trim().toLowerCase();
  return EMAIL.test(email) && email.length <= 254 ? email : null;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400 });
  }

  const email = tidyEmail(body.email || body.identifier);
  if (!email) {
    return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (!authReady()) {
    return Response.json({ error: "Secure sign-in is not configured yet." }, { status: 503 });
  }

  let existing;
  try {
    existing = await findByEmail(email);
  } catch (error) {
    console.error("[auth] could not read the account database:", error.message || error);
    return Response.json(
      { error: "We could not check your account just now. Please try again." },
      { status: 503 }
    );
  }

  const returning = Boolean(existing?.phone);
  let phone = existing?.phone || null;
  if (!returning) {
    phone = normalisePhone(body.phone);
    if (!phone) {
      return Response.json({
        ok: false,
        needsPhone: true,
        error: body.phone
          ? "Enter a valid 10-digit Indian mobile number."
          : "Add your mobile number once to finish creating your account.",
      }, { status: 409 });
    }
  }

  const id = `email:${email}`;
  try {
    const issued = await issue(id, { phone });
    if (!issued.ok) {
      if (issued.reason === "too_many") {
        return Response.json({
          error: "Too many codes requested. Please wait before trying again.",
          retryInSeconds: issued.retryInSeconds,
        }, { status: 429, headers: { "Retry-After": String(issued.retryInSeconds || 900) } });
      }
      return Response.json({ error: "Email verification is not configured yet." }, { status: 503 });
    }

    const delivery = await sendEmailCode(email, issued.code);
    if (!delivery.sent) throw new Error("Email delivery is not configured");
    return Response.json({
      ok: true,
      needsCode: true,
      email,
      returning,
      expiresInSeconds: issued.expiresInSeconds,
    });
  } catch (error) {
    console.error("[auth] could not send the sign-in code:", error.message || error);
    return Response.json(
      { error: "We could not send your sign-in code. Please try again." },
      { status: 503 }
    );
  }
}
