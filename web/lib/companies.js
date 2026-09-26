/**
 * Searching the list of listed companies.
 *
 * The list is web/data/companies.json, built by tools/build_company_list.py
 * and committed, so this is a plain import - no database, no upstream call,
 * and a reader typing into the search box is never waiting on BSE.
 *
 * Five thousand rows is small enough to scan on every keystroke. What matters
 * is not speed but ORDER: a reader typing "tata" wants Tata Motors, not Tata
 * Teleservices (Maharashtra), and typing "rel" wants Reliance Industries, not
 * Relaxo. So matches are ranked, and among equally good matches the bigger
 * company wins - which is what the list is already sorted by.
 */

import COMPANIES from "../data/companies.json";

/** Strip everything a person would not type: case, punctuation, spacing. */
function flatten(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Precomputed once per server process, not per keystroke.
const INDEX = COMPANIES.map((c) => ({
  ...c,
  flat: flatten(c.name),
  flatTicker: flatten(c.ticker),
}));

export const COMPANY_COUNT = INDEX.length;

/**
 * Best matches for what the reader has typed so far.
 *
 * Ranked, best first:
 *   0  the ticker exactly            "INFY"
 *   1  the name starts with it       "relia" -> Reliance Industries
 *   2  the ticker starts with it     "hdfcb" -> HDFCBANK
 *   3  a later word starts with it   "motors" -> Tata Motors
 *   4  it appears anywhere           "steel"  -> JSW Steel
 *
 * Rank 3 is worth the extra work. Indian company names put the distinctive
 * word second more often than not - a reader looking for Tata Motors may well
 * type "motors", and a plain prefix search answers that with nothing.
 */
export function searchCompanies(query, limit = 12) {
  const q = flatten(query);
  if (q.length < 2) return [];

  const words = String(query || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const out = [];

  for (const c of INDEX) {
    let rank = -1;

    if (c.flatTicker && c.flatTicker === q) rank = 0;
    else if (c.flat.startsWith(q)) rank = 1;
    else if (c.flatTicker && c.flatTicker.startsWith(q)) rank = 2;
    else {
      // Does any word of the NAME start with what was typed? Compared on the
      // original name rather than the flattened one, because flattening has
      // already thrown the word boundaries away.
      const nameWords = c.name.toLowerCase().split(/[^a-z0-9]+/);
      if (words.length === 1 && nameWords.some((w) => w.startsWith(words[0]))) {
        rank = 3;
      } else if (c.flat.includes(q)) {
        rank = 4;
      }
    }

    if (rank >= 0) out.push({ rank, c });
  }

  // Stable within a rank, and INDEX is already biggest-first, so the larger
  // company comes out on top of an equally good match.
  out.sort((a, b) => a.rank - b.rank);

  return out.slice(0, limit).map(({ c }) => ({
    isin: c.isin,
    code: c.code,
    name: c.name,
    ticker: c.ticker,
    board: c.board,
    key: c.key,
    cr: c.cr ?? null,
  }));
}

/**
 * The key a filing's company name is matched on.
 *
 * This is mcap.norm() from the Python side, ported exactly, and the exactness
 * is the point: companies.json stores the key that mcap.norm produced, and a
 * watchlist match is a string comparison against it. Two spellings of the
 * same algorithm would silently match nothing.
 *
 * It is NOT normCompany() from announcements.js, which is a different
 * algorithm for a different job and would be the wrong one here. That one
 * DELETES "india"; this one folds it to a single spelling and keeps it,
 * because deleting it turns both "Indian Oil Corporation" and "Oil India"
 * into "oil" - which is how IOC was once shown Oil India's market cap.
 */
export function matchKey(name) {
  let n = String(name || "").toLowerCase();
  n = n.replace(/\(\s*i\s*\)/g, " india ");
  n = n.replace(/\(\s*india\s*\)/g, " india ");
  n = n.replace(/\bindian\b/g, " india ");
  n = n.replace(/\([^)]{1,7}\)/g, " ");
  n = n.replace(
    /\b(limited|ltd|private|pvt|the|and|company|co|corporation|corp|inc)\b/g,
    " "
  );
  return n.replace(/[^a-z0-9]/g, "");
}

/** One company by ISIN - what the add endpoint trusts, rather than the body. */
export function companyByIsin(isin) {
  const want = String(isin || "").trim().toUpperCase();
  if (!want) return null;
  const c = INDEX.find((x) => x.isin === want);
  if (!c) return null;
  return {
    isin: c.isin,
    code: c.code,
    name: c.name,
    ticker: c.ticker,
    board: c.board,
    key: c.key,
    cr: c.cr ?? null,
  };
}
