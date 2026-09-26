/**
 * A reader's watchlist, and the filings that belong to it.
 *
 * Stored on the user document rather than in a collection of its own. A
 * portfolio is at most fifty short rows, it is always read with the profile
 * and never without it, and keeping it there means one document, one index and
 * one round trip - the same reasoning that put the newsletter flags there.
 *
 * How many stocks a reader may hold is the whole commercial point of the
 * feature, so the two numbers live here and nowhere else:
 *
 *   free     5
 *   premium  50
 *
 * "Premium" means access.premium from entitlements.js, which is true for a
 * paid subscription AND for the seven-day trial. The trial is sold on the
 * pricing page as "Complete access", so a trial that quietly capped the
 * watchlist at five would be the one thing on that page that is not true.
 */

import { MongoClient } from "mongodb";

export const PORTFOLIO_LIMITS = { free: 5, premium: 50 };

/** How many stocks this reader may hold. */
export function limitFor(access) {
  return access?.premium ? PORTFOLIO_LIMITS.premium : PORTFOLIO_LIMITS.free;
}

let clientPromise;
let indexesReady;

export function configured() {
  return Boolean(process.env.MONGODB_URI);
}

async function collection() {
  if (!configured()) throw new Error("MONGODB_URI is not configured");
  if (!clientPromise) {
    const client = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 6000,
    });
    clientPromise = client.connect();
  }
  const client = await clientPromise;
  const users = client
    .db(process.env.MONGODB_DB || "market_tide")
    .collection("users");

  // The alert run asks "who is watching any of these companies?" once per
  // scrape, against every reader. Without this index that is a collection
  // scan on every filing batch.
  if (!indexesReady) {
    indexesReady = users.createIndex({ "portfolio.key": 1 });
  }
  await indexesReady;
  return users;
}

/** The stocks this reader watches, oldest first. */
export async function listPortfolio(email) {
  const users = await collection();
  const row = await users.findOne(
    { email },
    { projection: { _id: 0, portfolio: 1 } }
  );
  return row?.portfolio || [];
}

/**
 * Add one company. Returns { ok } or { error, code } - never throws for a
 * full watchlist, because that is an ordinary answer and the page shows it.
 */
export async function addToPortfolio(email, company, limit) {
  const users = await collection();
  const held = await listPortfolio(email);

  if (held.some((s) => s.isin === company.isin)) {
    return { ok: true, already: true, stocks: held };
  }
  if (held.length >= limit) {
    return { ok: false, code: "limit_reached", limit, stocks: held };
  }

  const entry = {
    isin: company.isin,
    code: company.code,
    name: company.name,
    ticker: company.ticker,
    board: company.board,
    // The match key, stored WITH the stock rather than recomputed at alert
    // time. The alert run compares thousands of filings against every
    // watchlist; normalising a name it already normalised once, per filing
    // per reader, is work nobody needs.
    key: company.key,
    addedAt: new Date(),
  };

  // $addToSet cannot be used here - two entries differing only by addedAt are
  // different objects to Mongo, so a double click would store the stock
  // twice. The isin check above plus $push is the honest version.
  await users.updateOne({ email }, { $push: { portfolio: entry } });
  return { ok: true, stocks: [...held, entry] };
}

/** Remove one company by ISIN. */
export async function removeFromPortfolio(email, isin) {
  const users = await collection();
  await users.updateOne({ email }, { $pull: { portfolio: { isin } } });
  return listPortfolio(email);
}

/**
 * Trim a watchlist that is over the limit, keeping the oldest.
 *
 * A reader on Premium can hold fifty. When the subscription lapses they are
 * back to five, and the other forty-five have to go somewhere. Deleting them
 * on the spot would mean a lapsed reader who renews a week later finds an
 * empty watchlist, so nothing is deleted: the extras are moved aside, and
 * restored the moment they are entitled to them again.
 */
export async function enforceLimit(email, limit) {
  const users = await collection();
  const row = await users.findOne(
    { email },
    { projection: { _id: 0, portfolio: 1, portfolioOverflow: 1 } }
  );
  const held = row?.portfolio || [];
  const parked = row?.portfolioOverflow || [];

  if (held.length > limit) {
    const keep = held.slice(0, limit);
    const park = held.slice(limit);
    await users.updateOne(
      { email },
      { $set: { portfolio: keep, portfolioOverflow: [...park, ...parked] } }
    );
    return { stocks: keep, parked: park.length + parked.length };
  }

  // Back on Premium: take back as many as now fit.
  if (parked.length && held.length < limit) {
    const room = limit - held.length;
    const restored = parked.slice(0, room);
    await users.updateOne(
      { email },
      {
        $set: {
          portfolio: [...held, ...restored],
          portfolioOverflow: parked.slice(room),
        },
      }
    );
    return {
      stocks: [...held, ...restored],
      parked: parked.length - restored.length,
    };
  }

  return { stocks: held, parked: parked.length };
}

/** Everyone watching any of these match keys, for the alert run. */
export async function watchersOf(keys) {
  if (!keys.length) return [];
  const users = await collection();
  return users
    .find(
      { "portfolio.key": { $in: keys } },
      {
        projection: {
          _id: 0,
          email: 1,
          portfolio: 1,
          telegram: 1,
          alertsEnabled: 1,
          alertedFilingIds: 1,
          subscriptionPlan: 1,
          subscriptionStatus: 1,
          subscriptionEndsAt: 1,
          trialEndsAt: 1,
          trialStartedAt: 1,
        },
      }
    )
    .toArray();
}

/**
 * Remember what we have already sent, so a rescrape does not send it twice.
 *
 * The nightly run re-reads the whole week, so the same filing comes past the
 * alert code seven times. Capped at the last 300 ids per reader: fifty stocks
 * do not produce 300 filings in a week, and an unbounded array on a user
 * document is a slow leak that only shows up months later.
 */
export async function markAlerted(email, ids) {
  if (!ids.length) return;
  const users = await collection();
  await users.updateOne(
    { email },
    { $push: { alertedFilingIds: { $each: ids, $slice: -300 } } }
  );
}

/** Store the Telegram chat this reader linked, or clear it. */
export async function setTelegram(email, telegram) {
  const users = await collection();
  await users.updateOne(
    { email },
    telegram
      ? { $set: { telegram, alertsEnabled: true } }
      : { $unset: { telegram: "" } }
  );
}

/** Turn alerts on or off without unlinking Telegram. */
export async function setAlertsEnabled(email, on) {
  const users = await collection();
  await users.updateOne({ email }, { $set: { alertsEnabled: Boolean(on) } });
}
