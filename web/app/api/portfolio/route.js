/**
 * A reader's watchlist.
 *
 *   GET    /api/portfolio            -> { stocks, limit, level, telegram }
 *   POST   /api/portfolio  {isin}    -> add one
 *   DELETE /api/portfolio?isin=...   -> remove one
 *
 * Signing in is required, because a watchlist belongs to somebody. Premium is
 * NOT required: the free plan is five stocks, not zero. What Premium changes
 * is the number, and that number is decided in one place - limitFor() in
 * lib/portfolio.js.
 *
 * The company is looked up from our own list by ISIN and stored from THAT,
 * never from the request body. Otherwise a reader could post any name and
 * match key they liked, and the alert run would happily send them somebody
 * else's filings.
 */

import { accessForRequest } from "../../../lib/entitlements";
import {
  addToPortfolio,
  configured,
  enforceLimit,
  limitFor,
  removeFromPortfolio,
} from "../../../lib/portfolio";
import { companyByIsin } from "../../../lib/companies";

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
    // Checked on the way in rather than at the moment a subscription lapses:
    // nothing runs when a plan expires, so this is the only place that can
    // notice. It also restores parked stocks when a reader comes back.
    const { stocks, parked } = await enforceLimit(email, limit);
    return Response.json(
      {
        stocks,
        parked,
        limit,
        level: access.level,
        premium: access.premium,
        telegram: profile?.telegram
          ? { linked: true, username: profile.telegram.username || null }
          : { linked: false },
        alertsEnabled: profile?.alertsEnabled !== false,
      },
      { headers: PRIVATE }
    );
  } catch (error) {
    console.error("[portfolio] read failed:", error);
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
    const result = await addToPortfolio(email, company, limit);

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
    console.error("[portfolio] add failed:", error);
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
    const stocks = await removeFromPortfolio(email, isin.trim().toUpperCase());
    return Response.json(
      { ok: true, stocks, limit: limitFor(access) },
      { headers: PRIVATE }
    );
  } catch (error) {
    console.error("[portfolio] remove failed:", error);
    return Response.json(
      { error: "Could not remove that stock." },
      { status: 500, headers: PRIVATE }
    );
  }
}
