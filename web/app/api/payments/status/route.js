import { getCashfreeOrder, validPaidOrder } from "../../../../lib/cashfree";
import { activatePaidOrder, findOrderForUser } from "../../../../lib/payments";
import { currentUser } from "../../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function emailFromSession(request) {
  const user = currentUser(request);
  if (!user || user.channel !== "email") return null;
  return user.id.slice(user.id.indexOf(":") + 1).trim().toLowerCase();
}

export async function GET(request) {
  const email = emailFromSession(request);
  if (!email) return Response.json({ error: "Please sign in to view this payment." }, { status: 401 });

  const orderId = new URL(request.url).searchParams.get("order_id") || "";
  if (!/^mt_\d+_[a-f0-9]{12}$/.test(orderId)) {
    return Response.json({ error: "Invalid payment order." }, { status: 400 });
  }

  try {
    const localOrder = await findOrderForUser(orderId, email);
    if (!localOrder) return Response.json({ error: "Payment order not found." }, { status: 404 });

    const cashfreeOrder = await getCashfreeOrder(orderId);
    if (validPaidOrder(cashfreeOrder)) {
      const result = await activatePaidOrder({
        orderId,
        cfOrderId: cashfreeOrder.cf_order_id,
      });
      return Response.json({
        status: "PAID",
        orderId,
        subscriptionEndsAt: result.subscription?.subscriptionEndsAt || null,
      });
    }

    return Response.json({
      status: cashfreeOrder.order_status || localOrder.status || "ACTIVE",
      orderId,
    });
  } catch (error) {
    console.error("[payments] status check failed:", error.code || error.message || error);
    return Response.json({ error: "Could not verify the payment yet." }, { status: 502 });
  }
}
