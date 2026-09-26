import { normalisePhone } from "../../../lib/phone";
import {
  countNewsletterSubscribers,
  configured as usersConfigured,
  markKitSync,
  saveLeadUser,
  subscribeUser,
} from "../../../lib/users";
import {
  configured as kitConfigured,
  upsertSubscriber as upsertKitSubscriber,
} from "../../../lib/kit";

export const dynamic = "force-dynamic";

// Deliberately loose - it only needs to catch typos, not police what a valid
// address looks like. Real validation happens when you actually email them.
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }

  // Honeypot: a field hidden from people but filled in by simple bots.
  if (body.company) return Response.json({ ok: true, joined: true });

  const email = String(body.email || "").trim().toLowerCase();
  if (!LOOKS_LIKE_EMAIL.test(email) || email.length > 254) {
    return Response.json(
      { error: "That doesn't look like an email address." }, { status: 400 });
  }
  const source = String(body.source || "landing").slice(0, 40).toLowerCase();
  const isNewsletterSignup = source === "brief" || source === "landing";

  // A newsletter signup must have a durable MongoDB record. Do not silently
  // accept it into a fallback store when the member database is unavailable.
  if (isNewsletterSignup && !usersConfigured()) {
    return Response.json(
      { error: "Newsletter signup is temporarily unavailable. Please try again." },
      { status: 503 }
    );
  }

  // WhatsApp number is optional, but if given it has to be a real one.
  const rawPhone = String(body.phone || "").trim();
  let phone = null;
  if (rawPhone) {
    phone = normalisePhone(rawPhone);
    if (!phone) {
      return Response.json(
        { error: "That doesn't look like an Indian mobile number. 10 digits, starting 6-9." },
        { status: 400 });
    }
  }

  let subscription;
  try {
    if (usersConfigured()) {
      if (isNewsletterSignup) subscription = await subscribeUser({ email, phone, source });
      else await saveLeadUser({ email, phone, source });
    }
  } catch (err) {
    console.error("[waitlist] MongoDB save failed:", err);
    return Response.json(
      { error: "Couldn't save that. Please try again in a moment." }, { status: 500 });
  }

  const result = {
    backend: usersConfigured() ? "mongodb" : "none-configured",
    alreadyJoined: Boolean(subscription?.alreadySubscribed),
  };

  let kitSynced = null;
  if (isNewsletterSignup) {
    if (!kitConfigured()) {
      if (usersConfigured()) {
        await markKitSync(email, "failed", "not-configured").catch(() => {});
      }
      return Response.json({
        error: "Your email was saved, but email delivery is temporarily unavailable. Please try again.",
        saved: true,
        kitSynced: false,
      }, { status: 503 });
    }

    try {
      await upsertKitSubscriber(email);
      kitSynced = true;
      await markKitSync(email, "synced").catch((error) => {
        console.warn("[waitlist] could not record Kit sync state:", error.message || error);
      });
    } catch (error) {
      console.error("[waitlist] Kit sync failed:", error.message || error);
      if (usersConfigured()) {
        await markKitSync(email, "pending", error.message || "sync-pending").catch(() => {});
      }
      return Response.json({
        error: "Your email was saved, but we could not add it to email delivery. Please retry.",
        saved: true,
        kitSynced: false,
      }, { status: 502 });
    }
  }

  return Response.json({
    ok: true,
    joined: true,
    alreadyJoined: result.alreadyJoined,
    backend: result.backend,
    profileSaved: usersConfigured(),
    newsletterSignup: isNewsletterSignup,
    kitSynced,
    gaveWhatsApp: Boolean(phone),
    emailSent: false,
    whatsappSent: false,
  });
}

export async function GET() {
  try {
    return Response.json({ count: await countNewsletterSubscribers() });
  } catch {
    return Response.json({ count: 0 });
  }
}
