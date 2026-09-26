import crypto from "node:crypto";
import { readMarketMirror } from "../../../../lib/market-mirror.js";

export const dynamic = "force-dynamic";

/**
 * Start a scrape, from outside GitHub.
 *
 * GitHub's `schedule` event is best effort and drops runs under load - their
 * documentation says so, and on 1 September it dropped 16 of 23 slots, leaving
 * the site unchanged for nearly four hours over the middle of the day. Every
 * run that GitHub did create finished fine; the problem is that most were
 * never created.
 *
 * `workflow_dispatch` has no such behaviour: it starts within seconds, every
 * time. So an external clock calls this, and this dispatches the workflow.
 *
 *   GET/POST /api/cron/scrape      header:  x-cron-key: <CRON_SECRET>
 *   ...or                          query:   ?key=<CRON_SECRET>
 *
 * Needs two environment variables:
 *   CRON_SECRET            any long random string, shared with the caller
 *   GITHUB_DISPATCH_TOKEN  a fine-grained PAT for markettide/filed with
 *                          Actions: read and write. Nothing else.
 */

const OWNER = "markettide";
const REPO = "filed";
const WORKFLOW = "scrape.yml";
const BRIEF_WORKFLOW = "brief.yml";

// The brief is promised for 07:30 IST. IST is UTC+5:30, so the 02:00 UTC tick
// of the half-hourly clock is the one that should build it.
//
// The threshold is 07:25 rather than 07:30 on purpose. The clock is punctual
// to about ten seconds, but it is somebody else's clock and it fires either
// side of the mark - and "07:29:58" is one second short of 07:30, which would
// have meant waiting for the 08:00 tick and being half an hour late for the
// sake of two seconds. Nothing fires at 07:25 anyway: the previous tick is at
// 07:00, which is comfortably below this.
//
// Building a few seconds early changes nothing about the contents. The issue
// covers up to a 07:00 cutoff that newsletter.py sets for itself.
const BRIEF_HOUR_IST = 7;
const BRIEF_MINUTE_IST = 25;

// How stale the published data must be before a new run is worth starting.
// Longer than the 30-minute tick, so an in-flight run that is still writing
// days is never mistaken for a dead one.
const STALE_MINUTES = 40;

// How long a run may work without publishing before it counts as hung. A
// seven-day rebuild reads every PDF again before its first publish, which is
// about half an hour; a run past this is not slow, it is stuck.
const STUCK_MINUTES = 55;

/** One Redis command, or null if the store is unreachable or unconfigured. */
async function redis(command) {
  const mirrored = await readMarketMirror(command);
  if (mirrored.hit) return mirrored.result;
  const url =
    process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()).result;
  } catch {
    return null;
  }
}

/** Today's date in India, as YYYY-MM-DD. */
function todayIST(now = Date.now()) {
  return new Date(now + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Minutes past midnight, India time. */
function minutesIntoDayIST(now = Date.now()) {
  const d = new Date(now + 5.5 * 3600 * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/**
 * Make sure today's morning brief exists, and start it if it does not.
 *
 * The brief has its own `schedule` in brief.yml, and GitHub treated it exactly
 * the way it treats the scraper's: the 02:00 UTC slot ran at 07:03 UTC on
 * 1 September and 06:41 on 2 September, so a newsletter promised for half past
 * seven in the morning arrived at half past twelve. On 3 September the slot had
 * not fired at all forty-five minutes after it was due.
 *
 * The scraper was moved off `schedule` for this reason. The brief was not, and
 * nothing noticed, because a late newsletter still looks like a newsletter.
 *
 * Now the same thirty-minute clock that keeps the site fresh also asks whether
 * today's issue has been published, and starts it if it has not. Worst case the
 * brief is half an hour late instead of five hours.
 */
async function ensureBrief(token) {
  if (minutesIntoDayIST() < BRIEF_HOUR_IST * 60 + BRIEF_MINUTE_IST) {
    return "not due yet";
  }

  const raw = await redis(["GET", "mt:brief:index"]);
  if (raw === null) return "could not check";
  let newest = null;
  try {
    const days = JSON.parse(raw);
    if (Array.isArray(days) && days.length) newest = days[0];
  } catch {
    /* treat an unreadable index as "no issue today" */
  }
  if (newest === todayIST()) return "already published";

  // brief.yml does not cancel a run in progress, it queues behind it, so a
  // build that is simply slow must not be dispatched again every half hour.
  const running = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/` +
      `${BRIEF_WORKFLOW}/runs?status=in_progress&per_page=1`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    }
  )
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (running && running.total_count > 0) return "already building";

  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/` +
      `${BRIEF_WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
    }
  );
  return res.status === 204 ? "started" : `GitHub refused it (${res.status})`;
}

/**
 * Age in minutes of the scrape run already in progress, or null if none is.
 *
 * Freshness alone was not enough. A run that rebuilds the whole week reads
 * every PDF again before it publishes anything - about half an hour after a
 * rules change, because changing the rules deliberately throws the cached
 * verdicts away - so the site looks stale while a perfectly healthy run is
 * doing exactly what it was asked to do. That is how the 03:30 tick killed a
 * seven-day rebuild on 3 September, twenty-eight minutes in.
 *
 * So a young run counts as a reason to wait, whatever the timestamp says. An
 * OLD one does not: that is the hung run this watchdog exists to replace.
 */
async function runningForMinutes(token) {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/` +
        `${WORKFLOW}/runs?status=in_progress&per_page=1`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        cache: "no-store",
      }
    );
    if (!res.ok) return null;
    const runs = (await res.json()).workflow_runs || [];
    if (!runs.length) return null;
    const started = Date.parse(runs[0].run_started_at);
    if (!Number.isFinite(started)) return null;
    return Math.round((Date.now() - started) / 60000);
  } catch {
    return null;
  }
}


/**
 * Minutes since publish.py last wrote mt:meta, or null if that cannot be read.
 *
 * Null means "no opinion" and the dispatch goes ahead. Being unable to reach
 * Storage unavailability is not a reason to stop refreshing the site.
 */
async function minutesSincePublish() {
  const raw = await redis(["GET", "mt:meta"]);
  if (!raw) return null;
  try {
    const updated = JSON.parse(raw).updated;
    if (!updated) return null;
    const ms = Date.now() - Date.parse(updated);
    if (!Number.isFinite(ms) || ms < 0) return null;
    return Math.round(ms / 60000);
  } catch {
    return null;
  }
}


async function trigger(request) {
  const secret = process.env.CRON_SECRET;
  const token = process.env.GITHUB_DISPATCH_TOKEN;

  if (!secret || !token) {
    return Response.json(
      { error: "Not configured. Set CRON_SECRET and GITHUB_DISPATCH_TOKEN." },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const given = request.headers.get("x-cron-key") || url.searchParams.get("key");
  if (!sameSecret(given, secret)) {
    // 404 rather than 401: an endpoint that admits it exists invites guessing.
    return new Response("Not found.", { status: 404 });
  }

  // Blank means the workflow decides for itself - today only during the day,
  // the full seven days on the last pass of the night.
  const days = url.searchParams.get("days") || "";

  // Only start a run if the site actually needs one.
  //
  // The workflow cancels whatever is already running when a new run starts,
  // so an unconditional dispatch every 30 minutes means no run may ever take
  // longer than 30 minutes. A full seven-day rescrape takes about 35, and on
  // 3 September three consecutive attempts at one were each killed at the
  // half hour - which is also how a fix to the scoring rules could be pushed
  // three times without ever reaching the whole week.
  //
  // Freshness of the published data is the honest test, not the age of the
  // run: it is what "refreshes every 30 minutes" actually means, and a long
  // run keeps it fresh because publish.py writes mt:meta after every day it
  // finishes, not once at the end.
  //
  // So a healthy run is left alone, and one that has gone quiet is replaced.
  // ?force=1 skips the check.
  const force = url.searchParams.get("force") === "1";

  // NOTE: this whole route is currently inert in production.
  //
  // It needs CRON_SECRET and GITHUB_DISPATCH_TOKEN, and neither is set on the
  // Vercel project - "vercel env ls production" lists five variables, all of
  // them Redis. So it answers 503 to every caller and always has, and the
  // half-hourly refresh that does happen comes from scrape.yml dispatching its
  // own successor, not from here.
  //
  // The brief check below was written on 4 September and described as working.
  // It never ran once. It now lives in tools/ensure_brief.py, called by
  // scrape.yml, which is the thing that actually runs. This stays for the day
  // the two secrets are set, and is harmless until then.
  const brief = await ensureBrief(token);

  if (!force) {
    const age = await minutesSincePublish();
    if (age !== null && age < STALE_MINUTES) {
      return Response.json({
        ok: true,
        dispatched: null,
        skipped: `the site was updated ${age} minutes ago`,
        brief,
        at: new Date().toISOString(),
      });
    }

    // Stale, but something may already be fixing that.
    const working = await runningForMinutes(token);
    if (working !== null && working < STUCK_MINUTES) {
      return Response.json({
        ok: true,
        dispatched: null,
        skipped: `a run has been working for ${working} minutes`,
        brief,
        at: new Date().toISOString(),
      });
    }
  }

  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref: "main",
        ...(days ? { inputs: { days } } : {}),
      }),
    }
  );

  if (res.status !== 204) {
    const detail = (await res.text()).slice(0, 300);
    return Response.json(
      { error: `GitHub refused the dispatch (${res.status})`, detail },
      { status: 502 }
    );
  }

  return Response.json({
    ok: true,
    dispatched: WORKFLOW,
    days: days || "workflow decides",
    brief,
    at: new Date().toISOString(),
  });
}

export async function GET(request) {
  return trigger(request);
}

export async function POST(request) {
  return trigger(request);
}
