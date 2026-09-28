/**
 * A reader's watchlist, and the filings that belong to it.
 *
 * The Mongo field is still called `portfolio`. Renaming it would orphan
 * every watchlist already saved under that key, and a migration for
 * tidiness is not a trade worth making - the reader never sees it.
 *
 * Stored on the user document rather than in a collection of its own. A
 * a watchlist is at most fifty short rows, it is always read with the profile
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
import { accessForProfile } from "./entitlements.js";

export const WATCHLIST_LIMITS = { free: 5, premium: 50 };

/** How many stocks this reader may hold. */
export function limitFor(access) {
  return access?.premium ? WATCHLIST_LIMITS.premium : WATCHLIST_LIMITS.free;
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
export async function listWatchlist(email) {
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
export async function addToWatchlist(email, company, limit) {
  const users = await collection();
  const held = await listWatchlist(email);

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

  // Make the check and the write one MongoDB operation. The earlier read is
  // useful for the ordinary duplicate/full answers, but it cannot protect
  // against two browser requests arriving together. This filter does: only
  // one request can add a given ISIN, and no concurrent request can take the
  // array beyond the reader's plan limit.
  const write = await users.updateOne(
    {
      email,
      "portfolio.isin": { $ne: company.isin },
      $expr: {
        $lt: [
          { $size: { $ifNull: ["$portfolio", []] } },
          limit,
        ],
      },
    },
    { $push: { portfolio: entry } }
  );

  // Always return MongoDB's actual post-write state. It may differ from the
  // first read if another request added or removed a company concurrently.
  const stocks = await listWatchlist(email);
  if (write.modifiedCount === 1) return { ok: true, stocks };
  if (stocks.some((s) => s.isin === company.isin)) {
    return { ok: true, already: true, stocks };
  }
  if (stocks.length >= limit) {
    return { ok: false, code: "limit_reached", limit, stocks };
  }

  // A signed-in reader normally has a profile. If it vanished between the
  // entitlement check and this write, fail explicitly instead of pretending
  // the free-plan limit was reached.
  throw new Error("Watchlist profile disappeared before the update");
}

/** Remove one company by ISIN. */
export async function removeFromWatchlist(email, isin) {
  const users = await collection();
  await users.updateOne({ email }, { $pull: { portfolio: { isin } } });
  return listWatchlist(email);
}

/**
 * Build the permanent downgrade update. Extras are deliberately deleted:
 * renewing later starts from the five companies that survived the downgrade.
 */
export function accessCleanup(profile, limit) {
  const held = Array.isArray(profile?.portfolio) ? profile.portfolio : [];
  const parked = Array.isArray(profile?.portfolioOverflow)
    ? profile.portfolioOverflow : [];
  const stocks = held.slice(0, limit);
  const set = {};
  const unset = {};
  if (held.length > limit) set.portfolio = stocks;
  if (parked.length || Object.hasOwn(profile || {}, "portfolioOverflow")) {
    unset.portfolioOverflow = "";
  }
  if (limit === WATCHLIST_LIMITS.free) {
    if (profile?.telegram) unset.telegram = "";
    if (profile?.alertsEnabled !== false) set.alertsEnabled = false;
  }
  return {
    stocks,
    parked: 0,
    removed: Math.max(0, held.length - stocks.length) + parked.length,
    disconnected: Object.hasOwn(unset, "telegram"),
    update: Object.keys(set).length || Object.keys(unset).length
      ? { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) }
      : null,
  };
}

export async function enforceLimit(email, limit) {
  const users = await collection();
  const row = await users.findOne(
    { email },
    { projection: { _id: 0, portfolio: 1, portfolioOverflow: 1, telegram: 1, alertsEnabled: 1 } }
  );
  const result = accessCleanup(row, limit);
  if (result.update) await users.updateOne({ email }, result.update);
  return result;
}

/**
 * Reconcile every lapsed/free account. Feature access stops from the expiry
 * timestamp; this removes stale data on the next regular alert run as well.
 */
export async function cleanupExpiredPremiumBenefits(now = new Date()) {
  const users = await collection();
  const candidates = await users.find(
    { $or: [{ "portfolio.5": { $exists: true } }, { "portfolioOverflow.0": { $exists: true } }, { telegram: { $exists: true } }] },
    { projection: { portfolio: 1, portfolioOverflow: 1, telegram: 1, alertsEnabled: 1,
      subscriptionPlan: 1, subscriptionStatus: 1, subscriptionEndsAt: 1,
      trialStartedAt: 1, trialEndsAt: 1 } }
  ).toArray();
  let usersChanged = 0;
  let companiesRemoved = 0;
  let telegramDisconnected = 0;
  for (const profile of candidates) {
    if (accessForProfile(profile, now).premium) continue;
    const result = accessCleanup(profile, WATCHLIST_LIMITS.free);
    if (!result.update) continue;
    // Recheck dates in the write so a payment activated concurrently is safe.
    const write = await users.updateOne({
      _id: profile._id,
      $nor: [
        { trialEndsAt: { $gt: now } },
        { subscriptionPlan: "premium", subscriptionStatus: "active", subscriptionEndsAt: { $gt: now } },
      ],
    }, result.update);
    if (!write.modifiedCount) continue;
    usersChanged += 1;
    companiesRemoved += result.removed;
    if (result.disconnected) telegramDisconnected += 1;
  }
  return { usersChanged, companiesRemoved, telegramDisconnected };
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
      : { $unset: { telegram: "" }, $set: { alertsEnabled: false } }
  );
}

/** Turn alerts on or off without unlinking Telegram. */
export async function setAlertsEnabled(email, on) {
  const users = await collection();
  await users.updateOne({ email }, { $set: { alertsEnabled: Boolean(on) } });
}
