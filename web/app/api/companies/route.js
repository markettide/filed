/**
 * Search the list of listed companies.
 *
 *   GET /api/companies?q=relia  ->  { companies: [...] }
 *
 * Deliberately NOT gated on Premium. A reader on the free plan gets five
 * stocks, and they cannot choose five without being able to look them up.
 * Gating the search would make the free plan look broken rather than small.
 *
 * The list is a committed file, so this touches neither the database nor an
 * upstream API, and can be cached hard at the edge - it changes when we
 * re-run tools/build_company_list.py, which is about once a month.
 */

import { searchCompanies, COMPANY_COUNT } from "../../../lib/companies";

export const runtime = "nodejs";

export async function GET(request) {
  const q = new URL(request.url).searchParams.get("q") || "";

  // Under two characters every query matches half the market, so the answer
  // would be a thousand rows of noise. Say nothing instead.
  if (q.trim().length < 2) {
    return Response.json(
      { companies: [], total: COMPANY_COUNT },
      { headers: { "Cache-Control": "public, max-age=3600" } }
    );
  }

  return Response.json(
    { companies: searchCompanies(q), total: COMPANY_COUNT },
    { headers: { "Cache-Control": "public, max-age=3600" } }
  );
}
