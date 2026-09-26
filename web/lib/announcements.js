/**
 * Reads the announcements that publish.py pushed into Redis.
 *
 * Layout, one key per day so old days expire on their own:
 *   mt:day:2026-08-17  ->  JSON list of that day's important filings
 *   mt:index           ->  JSON list of the days currently held
 *   mt:meta            ->  when it last ran and what it found
 */

import { withServerCache } from "./server-cache";
import { marketMirrorEnabled, readMarketMirror } from "./market-mirror";

const DAYS = 7;

function creds() {
  return {
    url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
  };
}

export function configured() {
  const { url, token } = creds();
  return marketMirrorEnabled() || Boolean(url && token);
}

async function redis(command) {
  const mirrored = await readMarketMirror(command);
  if (mirrored.hit) return mirrored.result;
  const { url, token } = creds();
  if (!url || !token) return null;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Redis ${res.status}: ${await res.text()}`);
  return (await res.json()).result;
}

function parse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Exchange feeds sometimes use values such as "-" or "N/A" when a notice
// has no attachment. A non-empty placeholder is truthy in React and becomes a
// relative link (for example "-" becomes our own /- route). Only absolute web
// URLs are safe to expose as external links.
export function cleanExternalUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const parsed = new URL(text);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}

/**
 * A busy day can exceed the request size limit, so publish.py may have split it
 * into `key:0`, `key:1`… with a `key:parts` counter. This reassembles whichever
 * shape it finds.
 */
async function readKeys(keys) {
  if (!keys.length) return [];

  const partCounts = await redis(["MGET", ...keys.map((k) => `${k}:parts`)]);

  const wanted = [];
  keys.forEach((key, i) => {
    const n = Number(partCounts[i] || 1);
    if (n <= 1) wanted.push({ key, ref: key });
    else for (let p = 0; p < n; p++) wanted.push({ key, ref: `${key}:${p}` });
  });

  const blobs = await redis(["MGET", ...wanted.map((w) => w.ref)]);

  const out = new Map();
  wanted.forEach((w, i) => {
    const rows = parse(blobs[i]) || [];
    if (!out.has(w.key)) out.set(w.key, []);
    out.get(w.key).push(...rows);
  });
  return keys.map((k) => out.get(k) || []);
}

// Company names differ between the exchanges - "Mankind Pharma Ltd" on one,
// "Mankind Pharma Limited" on the other - so the suffixes come off before
// anything is compared.
const NAME_NOISE =
  /\b(limited|ltd|private|pvt|the|and|company|co|corporation|corp|india|indian|inc)\b/g;

function normCompany(name) {
  return String(name || "").toLowerCase().replace(NAME_NOISE, " ").replace(/[^a-z0-9]/g, "");
}

/**
 * One company, one day, one kind of news - one entry.
 *
 * The scraper folds duplicates too, but a day written by an older run still
 * holds its own, and re-reading a week of PDFs takes over an hour. Doing it
 * here as well means the site is right straight away and stays right even if
 * a future run writes something twice. It costs a few milliseconds.
 */
// One board meeting is filed under whichever headings apply, and they are
// rarely the same heading twice. Happiest Minds' merger with ITC Infotech
// came through as both "Scheme of Arrangement" and "Acquisition"; Kiri's
// warrant issue as both "Rights Issue" and "Pref". The summaries describe the
// same event but share almost no wording - "board approved amalgamation with
// ITC Infotech" against "announced a merger with ITC Infotech" - so word
// overlap cannot catch them either.
//
// Only the result/outcome/board-meeting trio is safe to merge across tags.
// Broad families used here previously hid distinct same-day events such as a
// QIP plus a preferential issue, or a dividend plus a buyback.
const FAMILY = {
  Results: "results",
  Outcome: "results",
  "Board Meeting": "results",
  // Concall, Investor Meet and Investor Presentation are their own
  // categories and stay separate - a reader filtering for next week's
  // earnings calls should find them, not have them folded into the result.
};

const family = (tag) => FAMILY[tag] || null;

// Repair narrowly identifiable stale classifications while the rolling Redis
// window still contains rows produced by an older set of rules.
const DEBT_SERVICE = /confirmation of redemption|payment of (interest|principal)|interest payment|commercial paper.{0,30}(maturity|redemption)|redemption.{0,35}(bond|debenture|ncd|ncrps|commercial paper)/i;
const BUYBACK_FOLLOWUP = /daily (report|disclosure).{0,100}(buy.?back|bought back)|closure of (the )?buy.?back offer/i;
const LEGAL_ORDER = /legal dispute|litigation|recovery suit|court.{0,35}(dismiss|adjourn|hear|appeal|order|stay)|tribunal.{0,35}(issued|passed|order|appeal)|securities appellate tribunal|case with sebi|appeal filed/i;
const CLEAR_PROMOTER_DEAL = /promoter(?: group)? (?:member|entity|shareholder|person)[^.]{0,90}(acquir|purchas|bought|sold|sell|dispos|transferr?|pledg)[^.]{0,90}(share|stake|holding)/i;
const MANAGEMENT_EVENT = /appoint|resign|cessation|managing director|chief executive|\bceo\b|chief financial|\bcfo\b|company secretary|executive director/i;
const RESULTS_EVENT = /financial results?|standalone and consolidated|revenue from operations|net profit|quarter ended/i;
const RATINGS_EVENT = /credit ratings?|\bicra\b|\bcrisil\b|care ratings|\[icra\]|rating reaffirmed/i;
const STAKE_DISCLOSURE = /\bsast\b|substantial acquisition of shares|regulation 31|reg\.?\s*31|shareholding|encumbrance|pledge/i;
const ANNUAL_REPORT_NOTICE = /web ?link.{0,40}annual report|letter to shareholders.{0,60}annual report|regulation 36\(1\)/i;
const FACTORY_LICENCE = /(?:factory|plant|unit).{0,50}licen[cs]e|renewal of.{0,40}licen[cs]e/i;
const ACQUISITION_LOI = /(?:letter of intent|\bloi\b).{0,100}(?:acqui|purchas|\bbuy\b)|(?:acqui|purchas|\bbuy\b).{0,100}(?:letter of intent|\bloi\b)/i;
const COMMERCIAL_ORDER = /customer|client|supply|services?|work order|contract (?:won|awarded|received|secured)|project|tender/i;

export function canonicalizeStoredRow(row) {
  const copy = { ...row };
  copy.pdf_url = cleanExternalUrl(copy.pdf_url) || cleanExternalUrl(copy.pdf_alt);
  copy.pdf_alt = cleanExternalUrl(copy.pdf_alt);
  copy.page_url = cleanExternalUrl(copy.page_url);
  copy.also_pdfs = [...new Set((Array.isArray(copy.also_pdfs) ? copy.also_pdfs : [])
    .map(cleanExternalUrl)
    .filter(Boolean))];
  const text = [copy.category, copy.headline, copy.summary, copy.why_it_matters]
    .map((value) => String(value || ""))
    .join(" ");

  if (copy.tag === "Buyback" && (DEBT_SERVICE.test(text) || BUYBACK_FOLLOWUP.test(text))) {
    copy.tag = "Routine";
    copy.score = 3;
  } else if (copy.tag === "Order" && LEGAL_ORDER.test(text)) {
    copy.tag = "Legal/Reg";
  } else if (copy.tag === "Order" && ACQUISITION_LOI.test(text) && !COMMERCIAL_ORDER.test(text)) {
    copy.tag = "Acquisition";
  } else if (copy.tag === "Acquisition" && CLEAR_PROMOTER_DEAL.test(text)) {
    copy.tag = "Promoter Buy/Sell";
  } else if (copy.tag === "Capacity Increase" && MANAGEMENT_EVENT.test(text)) {
    copy.tag = "Change In Management";
  } else if (copy.tag === "Rights Issue" && RESULTS_EVENT.test(text)) {
    copy.tag = "Results";
  } else if ((copy.tag === "Rights Issue" || copy.tag === "Fii") && RATINGS_EVENT.test(text)) {
    copy.tag = "Ratings Update";
  } else if (copy.tag === "Fii" && STAKE_DISCLOSURE.test(text)) {
    copy.tag = "Stake Change";
    copy.score = Math.min(Number(copy.score || 0), 50);
  } else if (copy.tag === "Clinical Trial" && ANNUAL_REPORT_NOTICE.test(text)) {
    copy.tag = "Routine";
    copy.score = 3;
  } else if (copy.tag === "Clinical Trial" && FACTORY_LICENCE.test(text)) {
    copy.tag = "Legal/Reg";
  }
  return copy;
}

export function isImportantRow(row) {
  return Boolean(row.summary) && Number(row.score || 0) >= 55 && row.tag !== "Routine";
}

function summaryWords(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
}

function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

/**
 * One company, one day, one piece of news - one entry.
 *
 * A single board meeting is filed several times over, each copy under a
 * different heading. Happiest Minds' merger with ITC Infotech arrived as
 * "Scheme of Arrangement", "Acquisition", "Press Release", "Change in
 * Registered Office Address" and more - seven entries, one event. Matching on
 * the heading cannot collapse those, because the headings are precisely what
 * differ.
 *
 * The summaries, though, say the same thing in nearly the same words, and by
 * the time anything is served they have been written. So filings from one
 * company on one day are compared on their summaries: near-identical ones
 * fold together, genuinely different news stays apart. Two filings under the
 * same heading are treated as the same event whatever their wording, which is
 * the old rule kept intact.
 */
function foldDuplicates(items) {
  const byCompanyDay = new Map();
  const out = [];

  for (const r of items) {
    const key = `${normCompany(r.company)}|${r.day}`;
    const seen = byCompanyDay.get(key) || [];
    const words = summaryWords(r.summary || r.headline);

    // Same heading, or the same kind of news, is the same event. Failing
    // both, the summaries have to agree.
    const match = seen.find(
      (e) =>
        e.row.tag === r.tag ||
        (family(e.row.tag) && family(e.row.tag) === family(r.tag)) ||
        overlap(words, e.words) >= 0.55
    );

    if (match) {
      match.row.also_filed = (match.row.also_filed || 0) + 1;
      if (r.pdf_url && (match.row.also_pdfs || []).length < 4) {
        match.row.also_pdfs = [...(match.row.also_pdfs || []), r.pdf_url];
      }
      // Keep every OTHER heading the event was filed under, so nothing is
      // hidden. Deleting the surviving row's own tag is right - repeating it
      // tells the reader nothing - but when a company files the same event
      // twice under the same heading, which is the common case, that leaves
      // the list empty while also_filed still counts them. The card then drew
      // "Also filed as" followed by nothing at all.
      const tags = new Set([...(match.row.also_tags || []), r.tag]);
      tags.delete(match.row.tag);
      match.row.also_tags = [...tags];
      continue;
    }

    const copy = { ...r };
    out.push(copy);
    seen.push({ row: copy, words });
    byCompanyDay.set(key, seen);
  }
  return out;
}

/**
 * Filings from the last 7 days, newest first.
 *
 * scope "important" (default) reads only the filings worth reading, with their
 * summaries. scope "all" also pulls the routine ones, which is a lot more data,
 * so the page only asks for it when someone clicks the All tab.
 */
async function loadRecent({ scope = "important", sort = "latest" } = {}) {
  if (!configured()) return { days: [], items: [], meta: null };

  const [indexRaw, metaRaw] = await redis(["MGET", "mt:index", "mt:meta"]);
  const days = (parse(indexRaw) || []).slice(0, DAYS);
  const meta = parse(metaRaw);

  if (!days.length) return { days: [], items: [], meta };

  const items = [];
  const push = (dayLists) =>
    dayLists.forEach((rows, i) => {
      for (const r of rows) items.push(canonicalizeStoredRow({ ...r, day: days[i] }));
    });

  push(await readKeys(days.map((d) => `mt:day:${d}`)));
  if (scope === "all") {
    push(await readKeys(days.map((d) => `mt:all:${d}`)));
  }

  // Newest first by default. Someone opening the dashboard wants to know what
  // has just landed, not what scored highest across the whole week - a buyback
  // from Tuesday should not sit above this evening's filings.
  const byLatest = (a, b) =>
    String(b.day).localeCompare(String(a.day)) ||
    String(b.time).localeCompare(String(a.time));

  const byImportance = (a, b) =>
    (b.score - a.score) || byLatest(a, b);

  items.sort(sort === "important" ? byImportance : byLatest);

  // Sorted first, so the entry that survives a fold is the best one under the
  // order the reader actually asked for.
  return { days, items: foldDuplicates(items), meta };
}

export async function recent({ scope = "important", sort = "latest" } = {}) {
  // One shared snapshot per scope/sort combination. Access control remains in
  // the API route and newly published filings appear within at most a minute.
  return withServerCache(
    `announcements:${scope}:${sort}`,
    60_000,
    () => loadRecent({ scope, sort })
  );
}

// ---------------------------------------------------------------------------
// Filtering, shared by the dashboard API and the Excel export.
//
// These lived only in the API route, so the export applied tag and day but
// silently ignored the size band and the search box. Someone who searched
// "Reliance", narrowed to large caps, saw six filings and clicked Excel got a
// workbook of the entire week - while the landing page promised "any filter,
// straight to Excel". One copy now, so they cannot drift again.
// ---------------------------------------------------------------------------

/** Market cap bands, in crore. */
export const BANDS = {
  mega: [100000, Infinity],   // above Rs 1 lakh crore
  large: [50000, 100000],     // Rs 50,000 crore to 1 lakh crore
  mid: [10000, 50000],        // Rs 10,000 to 50,000 crore
  small: [1000, 10000],       // Rs 1,000 to 10,000 crore
  micro: [0, 1000],           // below Rs 1,000 crore
};

export function inBand(row, band) {
  const range = BANDS[band];
  if (!range) return true;
  const cap = Number(row.mcap);
  if (!cap) return false;              // unknown size cannot claim a band
  return cap >= range[0] && cap < range[1];
}

/** Does this filing match the search box? */
export function matchesQuery(row, q) {
  if (!q) return true;
  // Every field coerced: rows from the "Everything" set carry no summary, and
  // an undefined interpolated into a template literal becomes the text
  // "undefined" - so searching for that word used to return the whole set.
  return [row.company, row.ticker, row.headline, row.summary, row.category]
    .map((v) => v || "")
    .join(" ")
    .toLowerCase()
    .includes(q);
}

/** Apply the dashboard's filters, in the order the dashboard applies them. */
export function applyFilters(items, { tag, day, band, q } = {}) {
  let out = items;
  if (day) out = out.filter((r) => r.day === day);
  if (q) {
    const needle = String(q).toLowerCase().trim();
    if (needle) out = out.filter((r) => matchesQuery(r, needle));
  }
  if (band) out = out.filter((r) => inBand(r, band));
  if (tag) out = out.filter((r) => r.tag === tag);
  return out;
}
