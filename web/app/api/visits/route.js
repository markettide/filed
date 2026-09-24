export const dynamic = "force-dynamic";

import { recordEngagement, recordTraffic, trafficTotals } from "../../../lib/engagement";
import { currentUser } from "../../../lib/session";

/**
 * Visitor counts are kept in MongoDB alongside the detailed sessions. Redis
 * used to receive several commands for every page view and heartbeat; its
 * lifetime totals are captured once as a no-loss migration baseline.
 *
 *   POST /api/visits   { id }   count this visit
 *   GET  /api/visits             just read the totals
 *
 * `id` is a random string the browser makes up and keeps in localStorage. No
 * IP address, no fingerprint, nothing that identifies a person - it only has
 * to be stable enough to tell one browser from another. MongoDB stores that
 * pseudonymous ID so a returning browser is not counted as a new visitor.
 */

function cleanId(v) {
  // Only what the browser is supposed to send, and never more of it than the
  // store should be asked to hold.
  return String(v || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
}

function cleanPath(value) {
  const path = String(value || "").slice(0, 160);
  return path.startsWith("/") && !path.includes("?") ? path : "/";
}

export async function GET() {
  const { baselineReady: _, ...totals } = await trafficTotals();
  return Response.json(totals, {
    // Shared counters are safe to cache and this collapses many browser polls
    // into one MongoDB read at Vercel's edge.
    headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
  });
}

export async function POST(request) {
  let id = "";
  let sessionId = "";
  let path = "/";
  let event = "pageview";
  try {
    const body = await request.json();
    id = cleanId(body.id);
    sessionId = cleanId(body.sessionId);
    path = cleanPath(body.path);
    event = ["pageview", "heartbeat", "resume", "end"].includes(body.event)
      ? body.event
      : "pageview";
  } catch {
    /* a body we cannot read is still a visit */
  }

  // Lifetime totals change only when a page is opened. Heartbeats update the
  // detailed session below, which is also the source for "reading now".
  if (id && event === "pageview") {
    await recordTraffic({ visitorId: id, event }).catch((error) => {
      console.error("[visits] traffic save failed:", error.message || error);
    });
  }

  if (id && sessionId) {
    const user = currentUser(request);
    const email = user?.channel === "email"
      ? String(user.id || "").slice(String(user.id || "").indexOf(":") + 1).toLowerCase()
      : null;
    await recordEngagement({ visitorId: id, sessionId, email, path, event }).catch((error) => {
      console.error("[visits] engagement save failed:", error.message || error);
    });
  }

  return Response.json({ ok: true }, {
    headers: { "Cache-Control": "no-store" },
  });
}
