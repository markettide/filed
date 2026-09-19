import { bulkBlockDeals, configured, applyFilters } from "../../../lib/deals";
import { workbook, download, stamp } from "../../../lib/sheet";
import { name } from "../../fmt";
import { requirePremiumAccess } from "../../../lib/entitlements";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_DAYS = 30;
const MAX_ROWS = 400;

// Only the fields the page draws.
function publicRow(row) {
  const fields = [
    "id", "day", "kind", "exchange", "symbol", "scrip", "company", "mcap",
    "who", "side", "shares", "price", "value", "netted", "gross_buy",
    "gross_sell", "rows", "remarks", "headline", "via_block",
  ];
  return Object.fromEntries(fields.map((k) => [k, row[k]]));
}

// The spreadsheet carries MORE than the page. Somebody downloading this
// wants to sort and filter it themselves, so the columns the page folds away -
// the gross buy and sell behind a netted figure, the scrip code, the
// exchange's own remark - are all here.
const COLUMNS = [
  { header: "Date", key: "day", width: 12, kind: "date" },
  { header: "Company", key: "company", width: 34 },
  { header: "Symbol", key: "symbol", width: 14 },
  { header: "Market cap (₹ Cr)", key: "mcap", width: 17, kind: "int" },
  { header: "Investor", key: "who", width: 42 },
  { header: "Action", key: "side", width: 10 },
  { header: "Shares", key: "shares", width: 15, kind: "int" },
  { header: "Price per share", key: "price", width: 16, kind: "price" },
  { header: "Value", key: "value", width: 17, kind: "money" },
  { header: "Deal type", key: "kind", width: 11 },
  { header: "Exchange", key: "exchange", width: 10 },
  { header: "Netted", key: "nettedLabel", width: 10 },
  { header: "Block window", key: "blockLabel", width: 14 },
  { header: "Also bought same day", key: "gross_buy", width: 21, kind: "int" },
  { header: "Also sold same day", key: "gross_sell", width: 21, kind: "int" },
  { header: "Exchange remark", key: "remarks", width: 30 },
];

export async function GET(request) {
  const entitlement = await requirePremiumAccess(request);
  if (entitlement instanceof Response) return entitlement;
  if (!configured()) {
    return Response.json(
      { error: "Bulk and block deal storage isn't configured yet." },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const days = Math.min(
    MAX_DAYS,
    Math.max(1, Number(url.searchParams.get("days")) || 7)
  );
  const side = url.searchParams.get("side") || "all";
  const kind = url.searchParams.get("kind") || "all";
  const exchange = url.searchParams.get("exchange") || "all";
  const q = url.searchParams.get("q") || "";
  const format = url.searchParams.get("format") || "json";
  const day = url.searchParams.get("day") || "all";

  const { days: held, deals, meta } = await bulkBlockDeals({ days });
  const filtered = applyFilters(deals, { side, kind, exchange, q, day });

  // Biggest first. A fund putting Rs 300 crore in is the reason to open this
  // page; a Rs 2 crore bulk deal in a micro-cap is not.
  filtered.sort((a, b) => (b.value || 0) - (a.value || 0));

  if (format === "xlsx") {
    const rows = filtered.map((d) => ({
      ...d,
      // Tidied names, the same ones the page shows. `symbol` is still the
      // column to join on if somebody is matching this against another sheet.
      company: name(d.company),
      who: name(d.who),
      // "Yes"/"" reads better in a column than true/false, and filters.
      nettedLabel: d.netted ? "Yes" : "",
      blockLabel: d.via_block ? "Yes" : "",
    }));
    const label =
      side === "buy" ? "buying" : side === "sell" ? "selling" : "deals";
    const buf = await workbook({
      sheetName: "Bulk & block deals",
      columns: COLUMNS,
      rows,
      notes: [
        `Market Tide — bulk and block ${label}, last ${days} days ` +
          `(downloaded ${stamp()}).`,
        "From the reports NSE and BSE publish after each close. Prices are " +
          "the exchange's weighted average. Day trades are netted out, so a " +
          "row marked Netted is the position left at the close. Nothing " +
          "here is advice.",
      ],
    });
    return download(buf, `markettide-bulk-block-${label}-${day === "all" ? stamp() : day}.xlsx`);
  }

  const buys = filtered.filter((d) => (d.side || "").toLowerCase() === "buy");
  const sells = filtered.filter((d) => (d.side || "").toLowerCase() === "sell");

  return Response.json({
    days: held,
    meta,
    counts: {
      total: filtered.length,
      buys: buys.length,
      sells: sells.length,
      boughtValue: buys.reduce((s, d) => s + (Number(d.value) || 0), 0),
      soldValue: sells.reduce((s, d) => s + (Number(d.value) || 0), 0),
    },
    items: filtered.slice(0, MAX_ROWS).map(publicRow),
  });
}
