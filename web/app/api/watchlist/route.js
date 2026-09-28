/**
 * A reader's watchlist.
 *
 *   GET    /api/watchlist            -> { stocks, limit, level, telegram }
 *   POST   /api/watchlist  {isin}    -> add one
 *   DELETE /api/watchlist?isin=...   -> remove one
 *
 * Signing in is required, because a watchlist belongs to somebody. Premium is
 * NOT required: the free plan is five stocks, not zero. What Premium changes
 * is the number, and that number is decided in one place - limitFor() in
 * lib/watchlist.js.
 *
 * The company is looked up from our own list by ISIN and stored from THAT,
 * never from the request body. Otherwise a reader could post any name and
 * match key they liked, and the alert run would happily send them somebody
 * else's filings.
 */

import { accessForRequest } from "../../../lib/entitlements";
import {
  addToWatchlist,
  configured,
  enforceLimit,
  limitFor,
  removeFromWatchlist,
} from "../../../lib/watchlist";
import { companyByIsin } from "../../../lib/companies";
import {
  botName as telegramBotName,
  configured as telegramConfigured,
} from "../../../lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "private, no-store" };

function signedOut() {
  return Response.json(
    { error: "Please sign in to build a watchlist.", code: "sign_in_required" },
    { status: 401, headers: PRIVATE }
  );
}

function notReady() {
  return Response.json(
    { error: "Watchlists are not configured on this deployment." },
    { status: 503, headers: PRIVATE }
  );
}

export async function GET(request) {
  if (!configured()) return notReady();
  const { email, profile, access } = await accessForRequest(request);
  if (!email) return signedOut();

  try {
    const limit = limitFor(access);
    // Access is effective immediately from its timestamps. This also performs
    // the permanent five-company trim and Telegram disconnect after expiry.
    const { stocks, parked } = await enforceLimit(email, limit);
    return Response.json(
      {
        stocks,
        parked,
        limit,
        level: access.level,
        premium: access.premium,
        telegramAvailable: telegramConfigured() && Boolean(telegramBotName()),
        telegramBot: telegramBotName(),
        telegram: access.premium && profile?.telegram
          ? { linked: true, username: profile.telegram.username || null }
          : { linked: false },
        alertsEnabled: access.premium && profile?.alertsEnabled !== false,
      },
      { headers: PRIVATE }
    );
  } catch (error) {
    console.error("[watchlist] read failed:", error);
    return Response.json(
      { error: "Could not load your watchlist." },
      { status: 500, headers: PRIVATE }
    );
  }
}

export async function POST(request) {
  if (!configured()) return notReady();
  const { email, access } = await accessForRequest(request);
  if (!email) return signedOut();

  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const company = companyByIsin(body?.isin);
  if (!company) {
    return Response.json(
      { error: "That company is not on our list." },
      { status: 400, headers: PRIVATE }
    );
  }

  try {
    const limit = limitFor(access);
    // Also reconcile here so a direct API call cannot retain an oversized
    // expired-trial list simply by skipping the watchlist page's GET first.
    await enforceLimit(email, limit);
    const result = await addToWatchlist(email, company, limit);

    if (!result.ok) {
      return Response.json(
        {
          error: access.premium
            ? `Premium holds ${limit} stocks. Remove one to add another.`
            : `The free plan holds ${limit} stocks. Premium holds ${
                limitFor({ premium: true })
              }.`,
          code: result.code,
          limit,
          stocks: result.stocks,
          premium: access.premium,
        },
        { status: 409, headers: PRIVATE }
      );
    }

    return Response.json(
      { ok: true, stocks: result.stocks, limit, already: Boolean(result.already) },
      { headers: PRIVATE }
    );
  } catch (error) {
    console.error("[watchlist] add failed:", error);
    return Response.json(
      { error: "Could not add that stock." },
      { status: 500, headers: PRIVATE }
    );
  }
}

export async function DELETE(request) {
  if (!configured()) return notReady();
  const { email, access } = await accessForRequest(request);
  if (!email) return signedOut();

  const isin = new URL(request.url).searchParams.get("isin");
  if (!isin) {
    return Response.json(
      { error: "Which stock?" },
      { status: 400, headers: PRIVATE }
    );
  }

  try {
    await enforceLimit(email, limitFor(access));
    const stocks = await removeFromWatchlist(email, isin.trim().toUpperCase());
    return Response.json(
      { ok: true, stocks, limit: limitFor(access) },
      { headers: PRIVATE }
    );
  } catch (error) {
    console.error("[watchlist] remove failed:", error);
    return Response.json(
      { error: "Could not remove that stock." },
      { status: 500, headers: PRIVATE }
    );
  }
}
