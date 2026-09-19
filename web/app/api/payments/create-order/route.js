import { createCashfreeOrder, cashfreeConfigured, cashfreeMode } from "../../../../lib/cashfree";
import {
  createPendingOrder,
  markOrderCreated,
  markOrderCreationFailed,
  newOrderId,
} from "../../../../lib/payments";
import { normalisePhone } from "../../../../lib/phone";
import { currentUser } from "../../../../lib/session";
import { findByEmail, saveDirectUser } from "../../../../lib/users";
import { accessForProfile } from "../../../../lib/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function emailFromSession(request) {
  const user = currentUser(request);
  if (!user || user.channel !== "email") return null;
  return user.id.slice(user.id.indexOf(":") + 1).trim().toLowerCase();
}

export async function POST(request) {
  const email = emailFromSession(request);
  if (!email) return Response.json({ error: "Please sign in before purchasing Premium." }, { status: 401 });
  if (!cashfreeConfigured()) {
    return Response.json({ error: "Cashfree test keys are not configured yet." }, { status: 503 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    // A saved profile phone is enough, so an empty request body is valid.
  }

  try {
    const profile = await findByEmail(email);
    const access = accessForProfile(profile);
    if (access.paidActive) {
      return Response.json(
        { code: "premium_active", error: "Your Premium plan is already active.", access },
        { status: 409 }
      );
    }
    if (access.trialAvailable) {
      return Response.json(
        { code: "trial_required", error: "Start your free seven-day trial before purchasing Premium.", access },
        { status: 409 }
      );
    }
    const phone = normalisePhone(body.phone) || normalisePhone(profile?.phone);
    if (!phone) {
      return Response.json(
        { code: "phone_required", error: "Enter a valid 10-digit Indian mobile number." },
        { status: 422 }
      );
    }
    if (phone !== profile?.phone) await saveDirectUser({ email, phone });

    const orderId = newOrderId();
    await createPendingOrder({ orderId, email, phone });
    const configuredBase = String(process.env.APP_BASE_URL || "").replace(/\/$/, "");
    const appBaseUrl = configuredBase || new URL(request.url).origin;

    try {
      const cashfreeOrder = await createCashfreeOrder({
        orderId,
        email,
        phone,
        name: profile?.name || "",
        appBaseUrl,
      });
      await markOrderCreated(orderId, cashfreeOrder);
      return Response.json({
        orderId,
        paymentSessionId: cashfreeOrder.payment_session_id,
        mode: cashfreeMode(),
      });
    } catch (error) {
      await markOrderCreationFailed(orderId, error.message);
      console.error("[payments] Cashfree order creation failed:", error.code || error.message);
      return Response.json(
        { error: error.message || "Could not start Cashfree checkout." },
        { status: error.status >= 400 && error.status < 500 ? 400 : 502 }
      );
    }
  } catch (error) {
    console.error("[payments] order setup failed:", error.message || error);
    return Response.json({ error: "Could not start checkout. Please try again." }, { status: 500 });
  }
}
