/**
 * Send portfolio alerts for whatever has just been filed.
 *
 *   GET /api/cron/alerts?key=<CRON_SECRET>
 *
 * Called by the scrape workflow once publishing is done, the same way
 * tools/ensure_brief.py calls in. It is a pull, not a push: the scrape does
 * not need to know who is watching what, and this does not need to know how
 * the scrape went.
 *
 * Only summarised filings are sent. A reader watching five companies does not
 * want to be told about a trading window closure at seven in the morning, and
 * the summary and the key numbers are most of what the message is for - a
 * filing with neither would arrive as a headline and a shrug.
 *
 * Nothing is sent twice. The nightly run re-reads the whole week, so every
 * filing passes this code about seven times; the ids already sent are kept on
 * the reader's own document and checked before anything goes out.
 */

import { recent } from "../../../../lib/announcements";
import { matchKey } from "../../../../lib/companies";
import { accessForProfile } from "../../../../lib/entitlements";
import {
  configured as dbReady,
  markAlerted,
  watchersOf,
} from "../../../../lib/portfolio";
import {
  configured as telegramReady,
  formatFiling,
  sendMessage,
} from "../../../../lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// How far back a filing may be and still count as news. The store holds seven
// days and the scrape re-reads all of them, so without this a reader who
// linked Telegram on Friday would get Monday's filings as though they had
// just happened. Anything older than this is history, and the dashboard is
// where history lives.
const FRESH_HOURS = 36;

// Per reader, per run. Someone watching fifty stocks on a results evening
// could match a hundred filings; fifty messages in a row is not an alert, it
// is a denial of service with a summary attached.
const MAX_PER_READER = 15;

function authorised(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const url = new URL(request.url);
  return (
    request.headers.get("authorization") === `Bearer ${secret}` ||
    request.headers.get("x-cron-key") === secret ||
    url.searchParams.get("key") === secret
  );
}

/** When a stored row happened, as a timestamp. */
function filedAt(row) {
  const day = row.day || row.date;
  if (!day) return 0;
  // Stored times are IST, which is what the exchanges publish.
  const t = /^\d{2}:\d{2}/.test(row.time || "") ? row.time : "00:00";
  return Date.parse(`${day}T${t}:00+05:30`) || 0;
}

export async function GET(request) {
  if (!authorised(request)) return new Response("Not found.", { status: 404 });

  if (!dbReady()) {
    return Response.json({ error: "MONGODB_URI is not configured." }, { status: 503 });
  }
  if (!telegramReady()) {
    return Response.json(
      { error: "TELEGRAM_BOT_TOKEN is not configured." },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  // A dry run reports what it would send and sends nothing, which is how you
  // check this is matching the right filings without messaging anybody.
  const dryRun = url.searchParams.get("dry") === "1";
  const freshHours = Number(url.searchParams.get("hours")) || FRESH_HOURS;

  try {
    const { items } = await recent({ scope: "important", sort: "latest" });
    const cutoff = Date.now() - freshHours * 3600 * 1000;

    // Group the fresh filings by the company they belong to, so the database
    // is asked one question rather than one per filing.
    const byKey = new Map();
    for (const row of items) {
      if (!row.summary) continue;
      if (filedAt(row) < cutoff) continue;
      const key = matchKey(row.company);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(row);
    }

    if (!byKey.size) {
      return Response.json({ ok: true, filings: 0, sent: 0, readers: 0 });
    }

    const watchers = await watchersOf([...byKey.keys()]);
    const now = new Date();
    let sent = 0;
    let reached = 0;
    const skipped = { noTelegram: 0, notPremium: 0, alertsOff: 0, nothingNew: 0 };

    for (const reader of watchers) {
      // Alerts are the Premium half of the watchlist. A lapsed reader keeps
      // the list and the dashboard; the messages stop.
      if (!accessForProfile(reader, now).premium) {
        skipped.notPremium += 1;
        continue;
      }
      if (!reader.telegram?.chatId) {
        skipped.noTelegram += 1;
        continue;
      }
      if (reader.alertsEnabled === false) {
        skipped.alertsOff += 1;
        continue;
      }

      const already = new Set(reader.alertedFilingIds || []);
      const due = [];
      for (const stock of reader.portfolio || []) {
        for (const row of byKey.get(stock.key) || []) {
          if (already.has(row.id)) continue;
          already.add(row.id);          // a stock held twice must not send twice
          due.push({ row, stock });
        }
      }

      if (!due.length) {
        skipped.nothingNew += 1;
        continue;
      }

      due.sort((a, b) => filedAt(b.row) - filedAt(a.row));
      const batch = due.slice(0, MAX_PER_READER);
      const delivered = [];

      for (const { row, stock } of batch) {
        if (dryRun) {
          delivered.push(row.id);
          continue;
        }
        try {
          await sendMessage(reader.telegram.chatId, formatFiling(row, stock));
          delivered.push(row.id);
          sent += 1;
        } catch (error) {
          // A reader who blocked the bot must not stop the run for everyone
          // else, and must not have the filing marked as delivered either -
          // if they unblock it, they should still get it.
          console.error(`[alerts] ${reader.email}:`, error.message);
          break;
        }
      }

      // Everything matched is marked, not just what was sent. The filings
      // beyond MAX_PER_READER were deliberately dropped, and re-offering them
      // on the next run would mean a reader on a busy evening receives the
      // same backlog every hour until it clears.
      const marked = [...new Set([...delivered, ...due.map((d) => d.row.id)])];
      if (!dryRun && marked.length) await markAlerted(reader.email, marked);
      if (delivered.length) reached += 1;
    }

    return Response.json({
      ok: true,
      dryRun,
      companies: byKey.size,
      filings: [...byKey.values()].reduce((n, rows) => n + rows.length, 0),
      watchers: watchers.length,
      readers: reached,
      sent,
      skipped,
    });
  } catch (error) {
    console.error("[alerts] run failed:", error);
    return Response.json({ error: "Alert run failed." }, { status: 500 });
  }
}
