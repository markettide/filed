import { scheduleDailyBriefBroadcast, kitBroadcastConfigured } from "../../../../../lib/kit-broadcast";
import { briefDays } from "../../../../../lib/brief.js";
import {
  claimBriefBroadcast,
  completeBriefBroadcast,
  releaseBriefBroadcast,
} from "../../../../../lib/operational-state.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IST_OFFSET = "+05:30";
const STATUS_TTL_SECONDS = 90 * 86400;

function response(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private, max-age=0" },
  });
}

function authorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = request.headers.get("authorization") === `Bearer ${secret}`;
  const query = request.nextUrl.searchParams.get("key") === secret;
  return bearer || query;
}

function todayIST() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

function eightAmOrSoon(day) {
  const eightAm = new Date(`${day}T08:00:00${IST_OFFSET}`);
  return (eightAm.getTime() > Date.now() + 60000 ? eightAm : new Date(Date.now() + 60000)).toISOString();
}

async function handler(request) {
  if (!authorized(request)) return new Response("Not found.", { status: 404 });
  if (!kitBroadcastConfigured()) return response({ error: "Kit broadcast delivery is not configured." }, 503);

  const day = todayIST();
  try {
    const index = await briefDays();
    if (index[0] !== day) {
      return response({
        ok: false,
        retry: true,
        error: "Today’s report is not ready yet. Retry this endpoint in two minutes.",
        day,
      }, 409);
    }

    const claim = await claimBriefBroadcast(day);
    if (!claim.claimed) {
      return response({ ok: true, duplicatePrevented: true, day, broadcast: claim.record });
    }

    try {
      const broadcast = await scheduleDailyBriefBroadcast({ day, sendAt: eightAmOrSoon(day) });
      await completeBriefBroadcast(day, broadcast, STATUS_TTL_SECONDS);
      return response({
        ok: true,
        day,
        audience: "all active Kit subscribers",
        broadcast,
      });
    } catch (error) {
      await releaseBriefBroadcast(day).catch(() => {});
      throw error;
    }
  } catch (error) {
    console.error("[brief send cron] failed:", error.message || error);
    return response({ error: "Could not schedule today’s Kit broadcast." }, 502);
  }
}

export const GET = handler;
export const POST = handler;
