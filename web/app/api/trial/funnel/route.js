import { emailFromSession } from "../../../../lib/entitlements";
import { recordTrialFunnel } from "../../../../lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENTS = new Set(["gate_view", "cta_click"]);
const PATHS = /^\/(dashboard|insider|deals|sme|pricing|profile)(\/|$)/;

export async function POST(request) {
  const email = emailFromSession(request);
  if (!email) return Response.json({ error: "Sign in required." }, { status: 401 });

  try {
    const body = await request.json();
    const event = String(body.event || "");
    const path = String(body.path || "").slice(0, 80);
    if (!EVENTS.has(event) || !PATHS.test(path)) {
      return Response.json({ error: "Invalid trial event." }, { status: 400 });
    }
    await recordTrialFunnel(email, event, path);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[trial funnel] record failed:", error.message || error);
    return Response.json({ error: "Could not record trial event." }, { status: 503 });
  }
}
