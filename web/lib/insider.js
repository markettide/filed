/**
 * Insider trades, read back out of the KV store publish_insider.py writes.
 *
 * A filing under SEBI's Regulation 7(2) is a person, a quantity and a price -
 * not prose - so it is kept apart from the announcements and read here.
 */

import { withServerCache } from "./server-cache";

const URL_ =
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const DAYS = 7;

export function configured() {
  return Boolean(URL_ && TOKEN);
}

async function redis(command) {
  if (!configured()) return null;
  try {
    const r = await fetch(URL_, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
      cache: "no-store",
    });
    if (!r.ok) return null;
    return (await r.json()).result;
  } catch {
    return null;
  }
}

function parse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** One day's trades, reassembled from however many parts it was split into. */
async function readDay(day) {
  const parts = Number((await redis(["GET", `mt:insider:${day}:parts`])) || 0);
  if (!parts) {
    return parse(await redis(["GET", `mt:insider:${day}`])) || [];
  }
  const chunks = await Promise.all(
    Array.from({ length: parts }, (_, i) =>
      redis(["GET", `mt:insider:${day}:${i}`])
    )
  );
  return chunks.flatMap((c) => parse(c) || []);
}

/**
 * The last `days` days of trades, newest day first, each row carrying the day
 * it belongs to.
 */
async function loadInsiderTrades({ days = DAYS } = {}) {
  const index = parse(await redis(["GET", "mt:insider:index"])) || [];
  const meta = parse(await redis(["GET", "mt:insider:meta"]));
  const wanted = index.slice(0, days);
  if (!wanted.length) return { days: [], trades: [], meta };

  const perDay = await Promise.all(wanted.map(readDay));
  const trades = [];
  perDay.forEach((rows, i) => {
    for (const r of rows) trades.push({ ...r, day: wanted[i] });
  });

  return { days: wanted, trades, meta };
}

export async function insiderTrades({ days = DAYS } = {}) {
  return withServerCache(
    `insider:${days}`,
    60_000,
    () => loadInsiderTrades({ days })
  );
}

/** Rupees, the way an Indian reader expects to see them. */
export function money(n) {
  const v = Number(n) || 0;
  if (!v) return "";
  if (v >= 1e7) return `Rs ${(v / 1e7).toFixed(2)} cr`;
  if (v >= 1e5) return `Rs ${(v / 1e5).toFixed(2)} lakh`;
  return `Rs ${v.toLocaleString("en-IN")}`;
}

/**
 * Who this person is, in one word, for colouring and filtering.
 *
 * The exchange writes the category a dozen ways - "Promoter and Director",
 * "Promoters", "Promoter Group", "Immediate relative" - and a reader only
 * cares about the distinction between somebody who runs the company and
 * somebody who works there.
 */
export function who(row) {
  const c = (row.category || "").toLowerCase();
  if (c.includes("promoter")) return "promoter";
  if (c.includes("director")) return "director";
  if (c.includes("key managerial") || c.includes("kmp")) return "kmp";
  if (c.includes("relative")) return "relative";
  if (c.includes("employee") || c.includes("designated")) return "employee";
  return "other";
}

export function isBuy(row) {
  return (row.side || "").toLowerCase() === "buy";
}

export function isSell(row) {
  return (row.side || "").toLowerCase() === "sell";
}

/**
 * A pledge is not a trade, and it was drowning the page.
 *
 * Pledging shares is how a promoter borrows against a holding, and releasing
 * one is how they pay the loan back. Nobody bought or sold anything and
 * nobody expressed a view - but the SIZE of a pledge is the whole holding,
 * so these carry the largest rupee figures on the page and sorted straight to
 * the top. Seven of the first twelve rows were one company's pledge releases,
 * repeated, which is the least interesting thing here shown first and loudest.
 *
 * They are still published, under their own filter. They are just no longer
 * the first thing a reader meets.
 */
export function isPledge(row) {
  const s = (row.side || "").toLowerCase();
  return ["pledge", "encumbr", "revoke", "invoke"].some((k) => s.includes(k));
}

/** Filters the page applies, kept here so the page stays about layout. */
export function applyFilters(
  trades,
  { side = "all", role = "all", q = "", day = "all" } = {}
) {
  const needle = q.trim().toLowerCase();
  return trades.filter((t) => {
    // One trading day, when the reader has picked one.
    if (day !== "all" && (t.day || "") !== day) return false;
    if (side === "buy" && !isBuy(t)) return false;
    if (side === "sell" && !isSell(t)) return false;
    if (side === "pledge" && !isPledge(t)) return false;
    // "all" means every actual trade, not literally every row. Pledges have
    // their own tab because mixed in they hide everything else.
    if (side === "all" && isPledge(t)) return false;
    if (role !== "all" && who(t) !== role) return false;
    if (needle) {
      const hay = `${t.company || ""} ${t.who || ""} ${t.symbol || ""}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}
