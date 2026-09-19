import { insiderTrades, configured, applyFilters, isPledge } from "../../../lib/insider";
import { workbook, download, stamp } from "../../../lib/sheet";
import { name } from "../../fmt";
import { requirePremiumAccess } from "../../../lib/entitlements";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_DAYS = 30;
const MAX_ROWS = 400;

// Only the fields the page draws. The stored row also carries the XBRL's own
// bookkeeping - ISIN, scrip code, the filing's file name - which is worth
// keeping for later and not worth moving through Vercel on every request.
function publicRow(row) {
  const fields = [
    "id", "day", "company", "symbol", "exchange", "mcap", "who", "category",
    "side", "mode", "shares", "price", "value", "before_n", "before_pct",
    "after_n", "after_pct", "traded_on", "filed_on", "headline",
    "regulation", "revised", "url",
  ];
  return Object.fromEntries(fields.map((k) => [k, row[k]]));
}

// The spreadsheet carries MORE than the page, not less. Somebody downloading
// this wants to sort and filter it themselves, so the columns the page folds
// away - the holding before, the exchange, the link back to the filing - are
// all here.
const COLUMNS = [
  { header: "Date", key: "day", width: 12, kind: "date" },
  { header: "Company", key: "company", width: 34 },
  { header: "Symbol", key: "symbol", width: 12 },
  { header: "Market cap (₹ Cr)", key: "mcap", width: 17, kind: "int" },
  { header: "Person", key: "who", width: 32 },
  { header: "Role", key: "category", width: 20 },
  { header: "Action", key: "side", width: 15 },
  { header: "Shares", key: "shares", width: 15, kind: "int" },
  { header: "Price per share", key: "price", width: 16, kind: "price" },
  { header: "Value", key: "value", width: 17, kind: "money" },
  { header: "How", key: "mode", width: 18 },
  { header: "Holding before", key: "before_pct", width: 15, kind: "pct" },
  { header: "Holding after", key: "after_pct", width: 15, kind: "pct" },
  { header: "Exchange", key: "exchange", width: 10 },
  { header: "Filing", key: "url", width: 46 },
];

export async function GET(request) {
  const entitlement = await requirePremiumAccess(request);
  if (entitlement instanceof Response) return entitlement;
  if (!configured()) {
    return Response.json(
      { error: "Insider trading storage isn't configured yet." },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const days = Math.min(
    MAX_DAYS,
    Math.max(1, Number(url.searchParams.get("days")) || 7)
  );
  const side = url.searchParams.get("side") || "all";
  const role = url.searchParams.get("role") || "all";
  const q = url.searchParams.get("q") || "";
  const format = url.searchParams.get("format") || "json";
  const day = url.searchParams.get("day") || "all";

  const { days: held, trades, meta } = await insiderTrades({ days });
  const filtered = applyFilters(trades, { side, role, q, day });

  // Biggest first. A promoter putting Rs 20 crore in is the reason to open
  // this page; five hundred shares changing hands is not.
  filtered.sort((a, b) => (b.value || 0) - (a.value || 0));

  if (format === "xlsx") {
    // Rows with a named person only. The prose rows are a sentence read out
    // of a document - there are no columns to put them in, and a spreadsheet
    // of one long text cell per line helps nobody.
    //
    // Names are tidied to match the page. The exchange SHOUTS them, and
    // `symbol` is already the column to join on if somebody is matching this
    // against another sheet.
    const rows = filtered
      .filter((t) => (t.who || "").trim())
      .map((t) => ({ ...t, company: name(t.company), who: name(t.who) }));
    const label =
      side === "pledge" ? "pledges"
      : side === "buy" ? "buying"
      : side === "sell" ? "selling"
      : "trades";
    const buf = await workbook({
      sheetName: "Insider trades",
      columns: COLUMNS,
      rows,
      notes: [
        `Market Tide — insider ${label}, last ${days} days ` +
          `(downloaded ${stamp()}).`,
        "Filed with NSE and BSE under SEBI's Regulation 7(2). Employee stock " +
          "schemes, company welfare trusts and transfers inside a promoter " +
          "family are left out. Nothing here is advice.",
      ],
    });
    return download(buf, `markettide-insider-${label}-${day === "all" ? stamp() : day}.xlsx`);
  }

  const buys = filtered.filter((t) => (t.side || "").toLowerCase() === "buy");
  const sells = filtered.filter((t) => (t.side || "").toLowerCase() === "sell");

  return Response.json({
    days: held,
    meta,
    counts: {
      total: filtered.length,
      buys: buys.length,
      sells: sells.length,
      // So the page can offer the pledge tab honestly, and say nothing when
      // there were none.
      pledges: trades.filter(isPledge).length,
      boughtValue: buys.reduce((s, t) => s + (Number(t.value) || 0), 0),
      soldValue: sells.reduce((s, t) => s + (Number(t.value) || 0), 0),
    },
    items: filtered.slice(0, MAX_ROWS).map(publicRow),
  });
}
