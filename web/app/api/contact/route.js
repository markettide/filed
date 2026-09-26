import { emailConfigured, sendContactMessage } from "../../../lib/notify";
import { rateLimit } from "../../../lib/rate-limit";

export const runtime = "nodejs";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function tooMany(request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  try {
    const result = await rateLimit({
      scope: "contact",
      identifier: ip,
      maximum: 5,
      windowSeconds: 3600,
    });
    return !result.allowed;
  } catch (error) {
    console.error("[contact] rate limit unavailable:", error.message || error);
    return false;
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send a valid message." }, { status: 400 });
  }
  if (body.company) return Response.json({ ok: true });
  if (await tooMany(request)) {
    return Response.json({ error: "Too many messages. Please try again later." }, { status: 429 });
  }

  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const message = String(body.message || "").trim();
  if (!name || name.length > 80 || !EMAIL.test(email) || email.length > 254 || message.length < 10 || message.length > 3000) {
    return Response.json({ error: "Check your name, email and message, then try again." }, { status: 400 });
  }
  if (!emailConfigured()) {
    return Response.json({ error: "Email is not connected yet. Please use the email address above." }, { status: 503 });
  }
  try {
    await sendContactMessage({ name, email, message });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[contact] email failed:", error.message || error);
    return Response.json({ error: "Could not send your message just now. Please try again." }, { status: 502 });
  }
}
