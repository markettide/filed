import { configured as kitConfigured } from "../../../../lib/kit.js";
import { processTrialReminders } from "../../../../lib/trial-reminders.js";
import { configured as usersConfigured } from "../../../../lib/users.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const url = new URL(request.url);
  return (
    request.headers.get("authorization") === `Bearer ${secret}`
    || request.headers.get("x-cron-key") === secret
    || url.searchParams.get("key") === secret
  );
}

export async function GET(request) {
  if (!authorised(request)) return new Response("Not found.", { status: 404 });
  if (!usersConfigured()) {
    return Response.json({ error: "MONGODB_URI is not configured." }, { status: 503 });
  }
  if (!kitConfigured()) {
    return Response.json({ error: "KIT_API_KEY is not configured." }, { status: 503 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dry") === "1";
  const requestedLimit = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(requestedLimit, 250))
    : 100;

  try {
    const result = await processTrialReminders({ dryRun, limit });
    return Response.json({ ok: true, dryRun, ...result });
  } catch (error) {
    console.error("[trial reminders] cron failed:", error.message || error);
    return Response.json({ error: "Could not process trial reminders." }, { status: 502 });
  }
}

export const POST = GET;
