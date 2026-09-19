import { getCashfreeOrder, validPaidOrder, verifyCashfreeWebhook } from "../../../../lib/cashfree";
import { activatePaidOrder, findOrder, markOrderAttempt } from "../../../../lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-webhook-signature");
  const timestamp = request.headers.get("x-webhook-timestamp");
  if (!verifyCashfreeWebhook({ rawBody, signature, timestamp })) {
    return Response.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid webhook payload." }, { status: 400 });
  }

  const orderId = payload?.data?.order?.order_id;
  const payment = payload?.data?.payment || {};
  if (!orderId) return Response.json({ ok: true, ignored: "No order ID." });

  try {
    const localOrder = await findOrder(orderId);
    if (!localOrder) return Response.json({ ok: true, ignored: "Unknown order." });

    await markOrderAttempt({
      orderId,
      status: payment.payment_status || payload.type || "UNKNOWN",
      cfPaymentId: payment.cf_payment_id,
      message: payment.payment_message,
    });

    if (payment.payment_status !== "SUCCESS") {
      return Response.json({ ok: true, status: payment.payment_status || "IGNORED" });
    }

    const cashfreeOrder = await getCashfreeOrder(orderId);
    if (!validPaidOrder(cashfreeOrder)) {
      return Response.json({ error: "Cashfree order is not verified as paid." }, { status: 409 });
    }

    await activatePaidOrder({
      orderId,
      cfOrderId: cashfreeOrder.cf_order_id,
      cfPaymentId: payment.cf_payment_id,
      paidAt: payment.payment_time,
    });
    return Response.json({ ok: true, status: "PAID" });
  } catch (error) {
    console.error("[payments] webhook processing failed:", error.code || error.message || error);
    return Response.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
