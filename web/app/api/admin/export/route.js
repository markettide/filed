import ExcelJS from "exceljs";
import { isAdmin } from "../../../../lib/admin-auth";
import { adminData } from "../../../../lib/admin-data";
import { engagementSessionHistory } from "../../../../lib/engagement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NAVY = "172033";
const BLUE = "4F9CFF";
const PALE = "EAF2FF";
const WHITE = "FFFFFF";
const TEXT = "202533";
const MUTED = "687184";

function asDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function phoneText(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 12 && digits.startsWith("91")) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  if (digits.length === 10) return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  return `+${digits}`;
}

function title(sheet, text, subtitle) {
  sheet.views = [{ showGridLines: false }];
  sheet.getCell("A2").value = text;
  sheet.getCell("A2").font = { name: "Arial", size: 16, bold: true, color: { argb: TEXT } };
  sheet.getCell("A3").value = subtitle;
  sheet.getCell("A3").font = { name: "Arial", size: 10, italic: true, color: { argb: MUTED } };
  sheet.getRow(4).height = 8;
}

function styleTable(sheet, headerRow, lastRow, lastColumn) {
  const header = sheet.getRow(headerRow);
  header.height = 24;
  for (let column = 1; column <= lastColumn; column += 1) {
    const cell = header.getCell(column);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: WHITE } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  }
  for (let row = headerRow + 1; row <= lastRow; row += 1) {
    sheet.getRow(row).font = { name: "Arial", size: 10, color: { argb: TEXT } };
    if ((row - headerRow) % 2 === 0) {
      for (let column = 1; column <= lastColumn; column += 1) {
        sheet.getRow(row).getCell(column).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F5F7FB" } };
      }
    }
  }
  if (lastRow >= headerRow) sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: Math.max(headerRow, lastRow), column: lastColumn } };
  sheet.views = [{ state: "frozen", ySplit: headerRow, showGridLines: false }];
}

function addRows(sheet, headers, rows, widths) {
  const headerRow = 5;
  sheet.getRow(headerRow).values = headers;
  rows.forEach((row) => sheet.addRow(row));
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  styleTable(sheet, headerRow, sheet.rowCount, headers.length);
  return headerRow;
}

export async function GET(request) {
  if (!isAdmin(request)) return Response.json({ error: "Unauthorized." }, { status: 401 });

  try {
    const selectedDate = request.nextUrl.searchParams.get("date");
    const [data, sessionHistory] = await Promise.all([
      adminData(selectedDate, 90, { all: true }),
      engagementSessionHistory(90),
    ]);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Market Tide";
    workbook.created = new Date();
    workbook.modified = new Date();

    const overview = workbook.addWorksheet("Overview", { properties: { tabColor: { argb: NAVY } } });
    title(overview, "Market Tide admin export", `Generated ${new Date(data.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`);
    overview.columns = [{ width: 31 }, { width: 20 }, { width: 4 }, { width: 34 }, { width: 14 }];
    const metrics = [
      ["Selected date", data.engagement.date],
      ["Unique members", data.totals.members],
      ["Verified logins", data.totals.verified],
      ["Newsletter subscribers", data.totals.subscribed],
      ["Members with phone", data.totals.withPhone],
      ["Active paid members", data.totals.paid],
      ["Active free trials", data.totals.activeTrials],
      ["Expired trials without purchase", data.totals.expiredUnpaidTrials],
      ["Trials converted to paid", data.totals.convertedTrials],
      ["Members who reached a trial gate", data.totals.trialGateUsers],
      ["Members who clicked a trial CTA", data.totals.trialCtaUsers],
      ["Reading now", data.liveReaders.length],
      ["Visitors on selected date", data.engagement.totals.visitors],
      ["Sessions on selected date", data.engagement.totals.sessions],
      ["Page views on selected date", data.engagement.totals.pageViews],
      ["Reading time on selected date (minutes)", data.engagement.totals.durationSeconds / 60],
      ["Average session (minutes)", data.engagement.totals.averageSessionSeconds / 60],
    ];
    overview.getRow(5).values = ["Metric", "Value"];
    metrics.forEach((row) => overview.addRow(row));
    styleTable(overview, 5, overview.rowCount, 2);
    overview.getCell("B6").numFmt = "@";
    for (let row = 7; row <= 20; row += 1) overview.getCell(row, 2).numFmt = "#,##0";
    for (let row = 21; row <= 22; row += 1) overview.getCell(row, 2).numFmt = "#,##0.0";
    overview.getCell("D5").value = "Acquisition source";
    overview.getCell("E5").value = "Members";
    Object.entries(data.sourceCounts).sort((a, b) => b[1] - a[1]).forEach(([source, count], index) => {
      overview.getCell(6 + index, 4).value = source;
      overview.getCell(6 + index, 5).value = count;
    });
    const sourceLast = 5 + Object.keys(data.sourceCounts).length;
    styleTable(overview, 5, Math.max(5, sourceLast), 5);

    const daily = workbook.addWorksheet("Daily Traffic", { properties: { tabColor: { argb: BLUE } } });
    title(daily, "Daily traffic", "Last 90 days. Times are measured from first-party session heartbeats.");
    addRows(daily,
      ["Date", "Visitors", "Sessions", "Page views", "Reading minutes", "Average session minutes", "Signed-in sessions"],
      data.trend.map((day, index) => [
        asDate(`${day.date}T00:00:00+05:30`), day.visitors, day.sessions, day.pageViews,
        day.durationSeconds / 60,
        { formula: `IF(C${index + 6}=0,0,E${index + 6}/C${index + 6})`, result: day.averageSessionSeconds / 60 },
        day.identifiedSessionCount,
      ]),
      [15, 13, 13, 14, 18, 24, 20]
    );
    daily.getColumn(1).numFmt = "dd-mmm-yyyy";
    for (const column of [2, 3, 4, 7]) daily.getColumn(column).numFmt = "#,##0";
    for (const column of [5, 6]) daily.getColumn(column).numFmt = "#,##0.0";

    const live = workbook.addWorksheet("Live Now");
    title(live, "Reading now", "A visitor is live when an active tab has checked in during the last five minutes.");
    addRows(live,
      ["Visitor", "Email", "Phone", "Current page", "Reading minutes", "Page views", "Started", "Last heartbeat"],
      data.liveReaders.map((reader) => [
        reader.email || `Anonymous · ${String(reader.visitorId || "").slice(0, 8)}`,
        reader.email, phoneText(reader.phone), reader.currentPath, reader.readingSeconds / 60, reader.pageViews,
        asDate(reader.startedAt), asDate(reader.lastSeenAt),
      ]),
      [30, 34, 18, 24, 18, 13, 22, 22]
    );
    live.getColumn(5).numFmt = "#,##0.0";
    live.getColumn(3).numFmt = "@";
    live.getColumn(7).numFmt = live.getColumn(8).numFmt = "dd-mmm-yyyy hh:mm";

    const visitors = workbook.addWorksheet("Selected Day");
    title(visitors, `Visitors on ${data.engagement.date}`, "One row per visitor. Anonymous IDs cannot be matched to personal details until sign-in.");
    addRows(visitors,
      ["Visitor", "Email", "Phone", "Sessions", "Page views", "Whole-day minutes", "Average minutes", "Longest minutes", "First seen", "Last seen", "Pages"],
      data.engagement.visitors.map((visitor) => [
        visitor.email || `Anonymous · ${String(visitor.visitorId || "").slice(0, 8)}`,
        visitor.email, phoneText(visitor.phone), visitor.sessions, visitor.pageViews, visitor.durationSeconds / 60,
        visitor.averageSessionSeconds / 60, visitor.longestSessionSeconds / 60,
        asDate(visitor.firstSeenAt), asDate(visitor.lastSeenAt), (visitor.pages || []).join(", "),
      ]),
      [30, 34, 18, 12, 13, 20, 17, 17, 22, 22, 45]
    );
    for (const column of [6, 7, 8]) visitors.getColumn(column).numFmt = "#,##0.0";
    visitors.getColumn(3).numFmt = "@";
    visitors.getColumn(9).numFmt = visitors.getColumn(10).numFmt = "dd-mmm-yyyy hh:mm";

    const contacts = new Map(data.members.map((member) => [member.email, member.phone]));
    const sessions = workbook.addWorksheet("90 Day Sessions");
    title(sessions, "Session history", "One row per tracked session from the 90-day analytics retention window.");
    const sessionRows = sessionHistory.map((session) => [
      asDate(`${session.date}T00:00:00+05:30`),
      session.email || `Anonymous · ${String(session.visitorId || "").slice(0, 8)}`,
      session.email, phoneText(session.email ? contacts.get(session.email) : null),
      Number(session.durationSeconds || 0) / 60, Number(session.pageViews || 0),
      asDate(session.startedAt), asDate(session.lastSeenAt), session.currentPath || null,
      (session.pages || []).join(", "),
    ]);
    addRows(sessions,
      ["Date", "Visitor", "Email", "Phone", "Minutes", "Page views", "Started", "Last seen", "Last page", "Pages"],
      sessionRows, [15, 30, 34, 18, 14, 13, 22, 22, 22, 45]
    );
    sessions.getColumn(1).numFmt = "dd-mmm-yyyy";
    sessions.getColumn(5).numFmt = "#,##0.0";
    sessions.getColumn(4).numFmt = "@";
    sessions.getColumn(7).numFmt = sessions.getColumn(8).numFmt = "dd-mmm-yyyy hh:mm";

    const paidMembers = workbook.addWorksheet("Paid Members", { properties: { tabColor: { argb: "17B26A" } } });
    title(paidMembers, "Active paid members", "Verified successful payments with current Premium access. Trial-only members are excluded.");
    addRows(paidMembers,
      ["Email", "Phone", "Amount", "Currency", "Paid on", "Order ID", "Access starts", "Access ends", "Status"],
      data.paidMembers.map((member) => [
        member.email, phoneText(member.phone), member.amount, member.currency, asDate(member.paidAt),
        member.orderId, asDate(member.startsAt), asDate(member.endsAt), member.status,
      ]),
      [36, 19, 14, 12, 22, 34, 22, 22, 14]
    );
    paidMembers.getColumn(2).numFmt = "@";
    paidMembers.getColumn(3).numFmt = "₹#,##0.00";
    for (const column of [5, 7, 8]) paidMembers.getColumn(column).numFmt = "dd-mmm-yyyy hh:mm";

    const trialUsers = workbook.addWorksheet("Free Trials", { properties: { tabColor: { argb: "F59E0B" } } });
    title(trialUsers, "Seven-day free trials", "Expired without purchase identifies the members available for targeted follow-up.");
    addRows(trialUsers,
      ["Email", "Phone", "Trial started", "Trial ends", "Days left", "Days since end", "Gate views", "CTA clicks", "Last interest page", "Last interest", "Status", "Target for follow-up"],
      data.trialUsers.map((member) => [
        member.email, phoneText(member.phone), asDate(member.startedAt), asDate(member.endsAt),
        member.daysLeft, member.daysSinceEnd, member.gateViews, member.ctaClicks,
        member.lastInterestPath, asDate(member.lastInterestAt),
        member.status === "not-started" ? "Interested, trial not started" : member.status === "expired-unpaid" ? "Expired without purchase" : member.status === "converted" ? "Converted to paid" : "Active trial",
        member.targetable ? "Yes" : "No",
      ]),
      [36, 19, 22, 22, 13, 18, 13, 13, 22, 22, 26, 22]
    );
    trialUsers.getColumn(2).numFmt = "@";
    trialUsers.getColumn(3).numFmt = trialUsers.getColumn(4).numFmt = "dd-mmm-yyyy hh:mm";
    trialUsers.getColumn(10).numFmt = "dd-mmm-yyyy hh:mm";

    const members = workbook.addWorksheet("Members");
    title(members, "All members", "Email, phone, source and account status from the Market Tide member database.");
    addRows(members,
      ["Email", "Phone", "Sources", "Verified", "Newsletter", "Joined", "Last login", "Last activity"],
      data.members.map((member) => [
        member.email, phoneText(member.phone), (member.sources || []).join(", "), member.verified ? "Yes" : "No",
        member.subscribed ? "Yes" : "No", asDate(member.createdAt), asDate(member.lastLoginAt), asDate(member.lastActivityAt),
      ]),
      [36, 19, 34, 13, 15, 22, 22, 22]
    );
    for (const column of [6, 7, 8]) members.getColumn(column).numFmt = "dd-mmm-yyyy hh:mm";
    members.getColumn(2).numFmt = "@";

    for (const sheet of workbook.worksheets) {
      sheet.eachRow((row) => { row.alignment = { vertical: "middle" }; });
      sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="market-tide-admin-${data.engagement.date}.xlsx"`,
        "Cache-Control": "no-store, private, max-age=0",
      },
    });
  } catch (error) {
    console.error("[admin] export failed:", error.message || error);
    return Response.json({ error: "Could not create the Excel export." }, { status: 503 });
  }
}
