import ExcelJS from "exceljs";
import {
  recent, configured, applyFilters, isImportantRow,
} from "../../../../lib/announcements";
import { requirePremiumAccess } from "../../../../lib/entitlements";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const COLUMNS = [
  { header: "Date", key: "day", width: 12 },
  { header: "Time", key: "time", width: 15 },
  { header: "Company", key: "company", width: 38 },
  { header: "Exchange", key: "exchange", width: 11 },
  { header: "Ticker", key: "ticker", width: 12 },
  { header: "Market cap (Cr)", key: "mcap", width: 16 },
  { header: "Type", key: "tag", width: 14 },
  { header: "Impact", key: "impact", width: 10 },
  { header: "Score", key: "score", width: 8 },
  { header: "Category", key: "category", width: 34 },
  { header: "Summary", key: "summary", width: 70 },
  { header: "Key numbers", key: "numbers", width: 46 },
  { header: "Why it matters", key: "why_it_matters", width: 46 },
  { header: "Headline as filed", key: "headline", width: 52 },
  { header: "PDF", key: "pdf_url", width: 26 },
];

const IMPACT_FILL = {
  Positive: "FFE6F5EC",
  Negative: "FFFDECEB",
  Neutral: "FFF0F2F5",
};

export async function GET(request) {
  const entitlement = await requirePremiumAccess(request);
  if (entitlement instanceof Response) return entitlement;
  if (!configured()) {
    return new Response("Announcements storage isn't configured yet.", { status: 503 });
  }

  const url = new URL(request.url);
  const tag = url.searchParams.get("tag");
  const day = url.searchParams.get("day");
  const band = url.searchParams.get("band");
  const q = (url.searchParams.get("q") || "").toLowerCase().trim();
  const scope = url.searchParams.get("scope") === "all" ? "all" : "important";

  let items;
  try {
    ({ items } = await recent({ scope }));
  } catch (err) {
    console.error("[export]", err);
    return new Response("Couldn't build the file.", { status: 500 });
  }

  // The same rule the dashboard applies: worth reading means summarised. The
  // export skipped it, so a workbook could carry rows with an empty Summary
  // column that the screen deliberately hides.
  if (scope === "important") items = items.filter(isImportantRow);

  // Every filter, through the same code the API uses. Band and search used to
  // be dropped here, so the file never matched what was on screen.
  items = applyFilters(items, { tag, day, band, q });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Market Tide";
  wb.created = new Date();

  const ws = wb.addWorksheet("Announcements", {
    views: [{ state: "frozen", ySplit: 1 }],       // header stays put when scrolling
  });
  ws.columns = COLUMNS;

  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2933" } };
  head.height = 22;
  head.alignment = { vertical: "middle" };

  for (const r of items) {
    const row = ws.addRow({
      ...r,
      mcap: typeof r.mcap === "number" ? r.mcap : null,
      numbers: Array.isArray(r.key_numbers) ? r.key_numbers.join("; ") : "",
    });
    // Keep it a real number so it sorts and filters in Excel.
    row.getCell("mcap").numFmt = "#,##0";
    row.alignment = { vertical: "top", wrapText: true };

    const fill = IMPACT_FILL[r.impact];
    if (fill) {
      row.getCell("impact").fill = {
        type: "pattern", pattern: "solid", fgColor: { argb: fill },
      };
    }
    // Make the PDF a real clickable link rather than a wall of URL text.
    if (r.pdf_url) {
      row.getCell("pdf_url").value = { text: "Open filing", hyperlink: r.pdf_url };
      row.getCell("pdf_url").font = { color: { argb: "FF1F6FEB" }, underline: true };
    }
  }

  ws.autoFilter = { from: "A1", to: { row: 1, column: COLUMNS.length } };

  const buffer = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `market-tide-${tag ? tag.toLowerCase().replace(/\W+/g, "-") + "-" : ""}${stamp}.xlsx`;

  return new Response(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
