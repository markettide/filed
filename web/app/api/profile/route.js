import { currentUser } from "../../../lib/session";
import { normalisePhone } from "../../../lib/phone";
import { findByEmail, updateUserProfile } from "../../../lib/users";
import { accessForProfile } from "../../../lib/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sessionEmail(request) {
  const user = currentUser(request);
  if (!user || user.channel !== "email") return null;
  return user.id.slice(user.id.indexOf(":") + 1).trim().toLowerCase();
}

function publicProfile(profile, email) {
  const access = accessForProfile(profile);
  return {
    name: profile?.name || "",
    email,
    phone: profile?.phone || "",
    createdAt: profile?.createdAt || null,
    newsletter: {
      subscribed: Boolean(profile?.briefSubscribed),
      subscribedAt: profile?.briefSubscribedAt || null,
      deliveryStatus: profile?.kitSyncStatus || null,
    },
    subscription: {
      plan: access.paidActive ? "premium" : access.trialActive ? "trial" : "free",
      status: access.level,
      endsAt: profile?.subscriptionEndsAt || null,
      access,
    },
  };
}

export async function GET(request) {
  const email = sessionEmail(request);
  if (!email) return Response.json({ error: "Please sign in first." }, { status: 401 });

  try {
    const profile = await findByEmail(email);
    return Response.json({ profile: publicProfile(profile, email) });
  } catch (error) {
    console.error("[profile] lookup failed:", error);
    return Response.json({ error: "Could not load your profile." }, { status: 500 });
  }
}

export async function PATCH(request) {
  const email = sessionEmail(request);
  if (!email) return Response.json({ error: "Please sign in first." }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }

  const name = String(body.name || "").trim().replace(/\s+/g, " ");
  if (name.length > 80) {
    return Response.json({ error: "Name must be 80 characters or fewer." }, { status: 400 });
  }

  const phone = normalisePhone(body.phone);
  if (!phone) {
    return Response.json(
      { error: "Enter a valid 10-digit Indian mobile number." },
      { status: 400 }
    );
  }

  try {
    const profile = await updateUserProfile({ email, name, phone });
    return Response.json({ ok: true, profile: publicProfile(profile, email) });
  } catch (error) {
    console.error("[profile] update failed:", error);
    return Response.json({ error: "Could not save your profile." }, { status: 500 });
  }
}
