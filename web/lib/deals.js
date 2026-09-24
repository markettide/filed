/**
 * Bulk and block deals, read back out of the KV store publish_deals.py writes.
 *
 * A bulk or block deal is a name, a quantity and a price - one large investor
 * taking or leaving a position - so it is kept apart from the announcements,
 * the same way insider trades are.
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

/** One day's deals, reassembled from however many parts it was split into. */
async function readDay(day) {
  const parts = Number((await redis(["GET", `mt:deals:${day}:parts`])) || 0);
  if (!parts) {
    return parse(await redis(["GET", `mt:deals:${day}`])) || [];
  }
  const chunks = await Promise.all(
    Array.from({ length: parts }, (_, i) =>
      redis(["GET", `mt:deals:${day}:${i}`])
    )
  );
  return chunks.flatMap((c) => parse(c) || []);
}

/**
 * The last `days` days of deals, newest day first, each row carrying the day
 * it belongs to.
 */
async function loadBulkBlockDeals({ days = DAYS } = {}) {
  const index = parse(await redis(["GET", "mt:deals:index"])) || [];
  const meta = parse(await redis(["GET", "mt:deals:meta"]));
  const wanted = index.slice(0, days);
  if (!wanted.length) return { days: [], deals: [], meta };

  const perDay = await Promise.all(wanted.map(readDay));
  const out = [];
  perDay.forEach((rows, i) => {
    for (const r of rows) out.push({ ...r, day: r.day || wanted[i] });
  });

  return { days: wanted, deals: out, meta };
}

export async function bulkBlockDeals({ days = DAYS } = {}) {
  return withServerCache(
    `deals:${days}`,
    60_000,
    () => loadBulkBlockDeals({ days })
  );
}

export function isBuy(row) {
  return (row.side || "").toLowerCase() === "buy";
}

export function isSell(row) {
  return (row.side || "").toLowerCase() === "sell";
}

/** Filters the page applies, kept here so the page stays about layout. */
export function applyFilters(
  rows,
  { side = "all", kind = "all", exchange = "all", q = "", day = "all" } = {}
) {
  const needle = q.trim().toLowerCase();
  return rows.filter((r) => {
    // One trading day, when the reader has picked one. The exchanges publish
    // these after the close, so "what happened on Thursday" is a real
    // question and the window alone could not answer it.
    if (day !== "all" && (r.day || "") !== day) return false;
    if (side === "buy" && !isBuy(r)) return false;
    if (side === "sell" && !isSell(r)) return false;
    if (kind !== "all" && (r.kind || "").toLowerCase() !== kind) return false;
    if (exchange !== "all" && (r.exchange || "") !== exchange) return false;
    if (needle) {
      const hay = `${r.company || ""} ${r.who || ""} ${r.symbol || ""}`
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}
