import { recent, configured, isImportantRow } from "../../../lib/announcements";
import { requirePremiumAccess } from "../../../lib/entitlements";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 10;

// Only send fields rendered by the public pages. Stored rows can contain raw
// scraper/PDF metadata which is useful to the pipeline but expensive to move
// through Vercel on every dashboard request.
function publicRow(row) {
  const fields = [
    "id", "day", "company", "ticker", "mcap", "exchange", "time",
    "category", "tag", "impact", "headline", "summary", "key_numbers",
    "why_it_matters", "also_filed", "also_tags", "pdf_url", "page_url",
  ];
  return Object.fromEntries(fields.map((key) => [key, row[key]]));
}

// Market cap bands, in crore. A Rs 400 crore order means something entirely
// different at a Rs 900 crore company than at a Rs 2 lakh crore one, so the
// dashboard can be narrowed to the size of company a reader actually follows.
const BANDS = {
  mega: [100000, Infinity],   // above Rs 1 lakh crore
  large: [50000, 100000],     // Rs 50,000 crore to 1 lakh crore
  mid: [10000, 50000],        // Rs 10,000 to 50,000 crore
  small: [1000, 10000],       // Rs 1,000 to 10,000 crore
  micro: [0, 1000],           // below Rs 1,000 crore
};

function inBand(row, band) {
  const range = BANDS[band];
  if (!range) return true;
  const cap = Number(row.mcap);
  if (!cap) return false;              // unknown size cannot claim a band
  return cap >= range[0] && cap < range[1];
}

export async function GET(request) {
  const entitlement = await requirePremiumAccess(request);
  if (entitlement instanceof Response) return entitlement;
  if (!configured()) {
    return Response.json(
      { error: "Announcements storage isn't configured yet." }, { status: 503 });
  }

  try {
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") === "all" ? "all" : "important";
    const tag = url.searchParams.get("tag");
    const day = url.searchParams.get("day");
    const q = (url.searchParams.get("q") || "").toLowerCase().trim();
    const band = url.searchParams.get("band");
    const requestedPage = Number.parseInt(url.searchParams.get("page") || "1", 10);
    const requestedSize = Number.parseInt(
      url.searchParams.get("limit") || String(DEFAULT_PAGE_SIZE),
      10
    );
    const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Number.isFinite(requestedSize) && requestedSize > 0 ? requestedSize : DEFAULT_PAGE_SIZE
    );

    // SME or Main. The two boards are different products - an SME company is a
    // Rs 40 crore business with three analysts following it, and a reader
    // looking for one is not looking for the other - so each gets its own
    // dashboard rather than a filter buried in a sidebar.
    //
    // Filtered before the "universe" is built below, so the category counts,
    // the day counts and the market-cap bands all describe the board being
    // looked at. Filter it afterwards and the SME dashboard would show
    // Reliance's categories in its sidebar.
    //
    // Anything without a board reads as Main: filings stored before
    // sources.tag_boards existed carry no such field, and the main dashboard
    // is where they were until now.
    const board = url.searchParams.get("board");

    const sort = url.searchParams.get("sort") === "important" ? "important" : "latest";
    let { days, items, meta } = await recent({ scope, sort });

    // Worth reading means summarised - one set, not two. A day written before
    // that rule existed can still hold a filing marked important with no
    // summary against it, and showing "661 worth reading, 394 summarised" makes
    // the product look like it gave up halfway. Anything without a summary is
    // not offered as a headline item, whatever the stored data says.
    if (scope === "important") items = items.filter(isImportantRow);

    if (board === "SME") items = items.filter((r) => r.board === "SME");
    else if (board === "Main") items = items.filter((r) => r.board !== "SME");

    // Narrow by day and text first. Whatever survives is the universe the
    // category counts describe, so the sidebar keeps showing every category
    // even while one of them is selected.
    let universe = items;
    if (day) universe = universe.filter((r) => r.day === day);
    if (q) {
      universe = universe.filter((r) =>
        `${r.company} ${r.ticker} ${r.headline} ${r.summary} ${r.category}`
          .toLowerCase()
          .includes(q));
    }

    // Counted here, on the full set, because the browser cannot: what it
    // receives is capped and sorted newest first, so tallying the response
    // showed older days as 0 while clicking them filled the feed. Taken before
    // the day filter, so every day keeps showing its own total while one of
    // them is selected.
    const dayCounts = {};
    for (const r of items) {
      if (r.day) dayCounts[r.day] = (dayCounts[r.day] || 0) + 1;
    }

    // Counts for the size bands are taken before the band filter is applied,
    // so every band keeps showing its total while one of them is selected.
    const bandCounts = {};
    for (const key of Object.keys(BANDS)) {
      bandCounts[key] = universe.filter((r) => inBand(r, key)).length;
    }
    bandCounts.unknown = universe.filter((r) => !Number(r.mcap)).length;

    if (band && BANDS[band]) universe = universe.filter((r) => inBand(r, band));

    const tagCounts = {};
    for (const r of universe) tagCounts[r.tag] = (tagCounts[r.tag] || 0) + 1;

    // Category filter applies after the counts, and crucially before the cut -
    // otherwise picking a small category searches a list it was already
    // truncated out of, and comes back empty.
    let rows = tag ? universe.filter((r) => r.tag === tag) : universe;

    const total = rows.length;
    const summarised = rows.filter((r) => r.summary).length;   // == total when scope is important
    const offset = (page - 1) * pageSize;

    // The order above is the order we keep. Promoting summarised rows here
    // would silently undo a "latest first" sort.
    rows = rows.slice(offset, offset + pageSize).map(publicRow);

    return Response.json(
      {
        days,
        // The funnel's first number has to belong to the board being shown.
        // meta.scanned is the whole run, both boards, so the SME dashboard was
        // reading "19,139 filed on NSE & BSE" above 42 SME filings.
        //
        // scanned_sme and scanned_main are written per day by publish.py, but
        // only from 8 September onwards, so days stored before that have
        // neither. Then this is null and the dashboard leaves the step out.
        //
        // It used to fall back to counting the board's rows in hand, which was
        // worse than nothing: under scope=important those ARE the important
        // rows, so the funnel read "93 filed, 93 worth reading, 93 summarised"
        // - three identical numbers that describe nothing and look broken.
        meta: board
          ? {
              ...meta,
              scanned:
                Number(
                  board === "SME" ? meta?.scanned_sme : meta?.scanned_main
                ) || null,
            }
          : meta,
        scope,
        board: board || "all",
        sort,
        total,
        tagCounts,
        bandCounts,
        dayCounts,
        band: band || null,
        summarised,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        hasMore: offset + rows.length < total,
        truncated: offset + rows.length < total,
        count: rows.length,
        items: rows,
      },
      {
        headers: {
          // Browsers revalidate, while Vercel's CDN can reuse the same response
          // for two minutes instead of running the function for every visitor.
          "Cache-Control": "private, no-store",
        },
      });
  } catch (err) {
    console.error("[announcements]", err);
    return Response.json({ error: "Couldn't load announcements." }, { status: 500 });
  }
}
