import { listEmails } from "./store";
import { listUsersForAdmin } from "./users";
import { listPaidOrdersForAdmin } from "./payments";
import { dailyEngagement, engagementTrend, liveEngagement } from "./engagement";
import { trialSummary } from "./admin-trials";

const NEWSLETTER_SOURCES = new Set(["brief", "landing", "newsletter", "legacy-waitlist"]);
const ADMIN_PAGE_SIZE = 10;

function paginate(items, requestedPage, all = false) {
  if (all) {
    return {
      items,
      pagination: {
        page: 1, pageSize: items.length, total: items.length,
        totalPages: 1, hasPrevious: false, hasNext: false,
      },
    };
  }
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const page = Math.min(
    totalPages,
    Math.max(1, Number.parseInt(requestedPage, 10) || 1)
  );
  const start = (page - 1) * ADMIN_PAGE_SIZE;
  return {
    items: items.slice(start, start + ADMIN_PAGE_SIZE),
    pagination: {
      page,
      pageSize: ADMIN_PAGE_SIZE,
      total,
      totalPages,
      hasPrevious: page > 1,
      hasNext: page < totalPages,
    },
  };
}

function iso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function newest(...values) {
  return values.filter(Boolean).sort().at(-1) || null;
}

function sourceLabel(source) {
  if (!source || /^\d+$/.test(source)) return null;
  if (source === "club") return "Join page";
  if (NEWSLETTER_SOURCES.has(source)) return "Newsletter";
  if (source.includes("login")) return "Login";
  return source;
}

async function traffic() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return { total: 0, unique: 0, live: 0 };
  const now = Math.floor(Date.now() / 1000);
  try {
    const response = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        ["GET", "mt:visits:total"],
        ["PFCOUNT", "mt:visits:uniq"],
        ["ZCOUNT", "mt:visits:live", now - 300, "+inf"],
      ]),
      cache: "no-store",
    });
    const result = await response.json();
    const values = Array.isArray(result) ? result.map((item) => item.result) : [];
    return { total: Number(values[0] || 0), unique: Number(values[1] || 0), live: Number(values[2] || 0) };
  } catch {
    return { total: 0, unique: 0, live: 0 };
  }
}

export async function adminData(selectedDate, trendDays = 30, options = {}) {
  const [mongoRows, paidOrders, waitlistRows, visitTotals, engagement, liveReaders, trend] = await Promise.all([
    listUsersForAdmin(),
    listPaidOrdersForAdmin(),
    listEmails(),
    traffic(),
    dailyEngagement(selectedDate),
    liveEngagement(),
    engagementTrend(trendDays),
  ]);

  const members = new Map();
  const ensure = (email) => {
    const clean = String(email || "").trim().toLowerCase();
    if (!clean) return null;
    if (!members.has(clean)) {
      members.set(clean, {
        email: clean, phone: null, sources: new Set(), verified: false, subscribed: false,
        createdAt: null, lastLoginAt: null, lastActivityAt: null,
      });
    }
    return members.get(clean);
  };

  for (const row of mongoRows) {
    const member = ensure(row.email);
    if (!member) continue;
    member.phone = row.phone || member.phone;
    member.verified = Boolean(row.emailVerifiedAt);
    const subscriptionSource = String(row.briefSubscriptionSource || "").toLowerCase();
    member.subscribed = Boolean(row.briefSubscribed && NEWSLETTER_SOURCES.has(subscriptionSource));
    member.createdAt = iso(row.createdAt);
    member.lastLoginAt = iso(row.lastLoginAt);
    if (member.verified) member.sources.add("Login");
    const subscriptionLabel = sourceLabel(subscriptionSource);
    if (subscriptionLabel) member.sources.add(subscriptionLabel);
    for (const source of row.acquisitionSources || []) {
      const label = sourceLabel(String(source).toLowerCase());
      if (label) member.sources.add(label);
    }
    member.lastActivityAt = newest(
      member.createdAt, member.lastLoginAt, iso(row.emailVerifiedAt), iso(row.updatedAt),
      iso(row.briefSubscribedAt), iso(row.briefSubscriptionUpdatedAt), iso(row.leadUpdatedAt)
    );
  }

  for (const row of waitlistRows) {
    const member = ensure(row.email);
    if (!member) continue;
    member.phone = member.phone || row.phone || null;
    const source = String(row.source || "waitlist").toLowerCase();
    member.subscribed = member.subscribed || NEWSLETTER_SOURCES.has(source);
    const label = sourceLabel(source);
    if (label) member.sources.add(label);
    member.createdAt = member.createdAt || iso(row.at);
    member.lastActivityAt = newest(member.lastActivityAt, iso(row.at));
  }

  const rows = [...members.values()].map((member) => ({ ...member, sources: [...member.sources] }))
    .sort((a, b) => String(b.lastActivityAt || b.createdAt || "").localeCompare(String(a.lastActivityAt || a.createdAt || "")));
  const contacts = new Map(rows.map((member) => [member.email, member]));
  const withContact = (visitor) => ({
    ...visitor,
    phone: visitor.email ? contacts.get(visitor.email)?.phone || null : null,
  });
  const engagementVisitors = engagement.visitors.map(withContact);
  const identifiedLiveReaders = liveReaders.map(withContact);
  const sourceCounts = {};
  for (const member of rows) for (const source of member.sources) sourceCounts[source] = (sourceCounts[source] || 0) + 1;

  const memberNeedle = String(options.memberQuery || "").trim().toLowerCase();
  const matchingMembers = memberNeedle
    ? rows.filter((member) =>
        [member.email, member.phone, ...member.sources]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(memberNeedle)
      )
    : rows;
  const memberResult = paginate(matchingMembers, options.memberPage, options.all);
  const now = new Date();
  const paidOrderById = new Map(paidOrders.map((order) => [order.orderId, order]));
  const latestPaidOrderByEmail = new Map();
  for (const order of paidOrders) {
    const email = String(order.email || "").trim().toLowerCase();
    if (email && !latestPaidOrderByEmail.has(email)) latestPaidOrderByEmail.set(email, order);
  }
  const paidMembers = mongoRows
    .filter((user) =>
      user.subscriptionPlan === "premium" &&
      user.subscriptionStatus === "active" &&
      user.subscriptionEndsAt &&
      new Date(user.subscriptionEndsAt) > now
    )
    .map((user) => {
      const email = String(user.email || "").trim().toLowerCase();
      const order = paidOrderById.get(user.latestPaymentOrderId) || latestPaidOrderByEmail.get(email) || null;
      return {
        email,
        phone: user.phone || order?.phone || null,
        orderId: order?.orderId || user.latestPaymentOrderId || null,
        amount: Number(order?.amount || 0),
        currency: order?.currency || "INR",
        paidAt: iso(order?.paidAt || order?.createdAt),
        startsAt: iso(user.subscriptionStartsAt),
        endsAt: iso(user.subscriptionEndsAt),
        status: user.subscriptionStatus,
      };
    })
    .sort((a, b) => String(b.paidAt || b.startsAt || "").localeCompare(String(a.paidAt || a.startsAt || "")));
  const paidNeedle = String(options.paidQuery || "").trim().toLowerCase();
  const matchingPaidMembers = paidNeedle
    ? paidMembers.filter((member) =>
        [member.email, member.phone, member.orderId]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(paidNeedle)
      )
    : paidMembers;
  const paidResult = paginate(matchingPaidMembers, options.paidPage, options.all);
  const trialUsers = mongoRows
    .map((user) => {
      const trial = trialSummary(user, now);
      const gateViews = Math.max(0, Number(user.trialGateViews || 0));
      const ctaClicks = Math.max(0, Number(user.trialCtaClicks || 0));
      if (!trial && !gateViews && !ctaClicks) return null;
      return {
        email: String(user.email || "").trim().toLowerCase(),
        phone: user.phone || null,
        gateViews,
        ctaClicks,
        lastInterestAt: iso(user.trialLastCtaAt || user.trialLastGateAt),
        lastInterestPath: user.trialLastInterestPath || null,
        ...(trial || {
          startedAt: null,
          endsAt: null,
          daysLeft: null,
          daysSinceEnd: null,
          status: "not-started",
          targetable: true,
        }),
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.lastInterestAt || b.startedAt || "").localeCompare(String(a.lastInterestAt || a.startedAt || "")));
  const trialNeedle = String(options.trialQuery || "").trim().toLowerCase();
  const requestedTrialStatus = String(options.trialStatus || "all").trim().toLowerCase();
  const matchingTrialUsers = trialUsers.filter((member) => {
    const matchesStatus = requestedTrialStatus === "all" || member.status === requestedTrialStatus;
    const matchesQuery = !trialNeedle || [member.email, member.phone]
      .filter(Boolean).join(" ").toLowerCase().includes(trialNeedle);
    return matchesStatus && matchesQuery;
  });
  const trialResult = paginate(matchingTrialUsers, options.trialPage, options.all);
  const visitorResult = paginate(engagementVisitors, options.visitorPage, options.all);
  const liveResult = paginate(identifiedLiveReaders, options.livePage, options.all);

  return {
    generatedAt: new Date().toISOString(),
    traffic: { ...visitTotals, live: identifiedLiveReaders.length },
    totals: {
      members: rows.length,
      verified: rows.filter((row) => row.verified).length,
      subscribed: rows.filter((row) => row.subscribed).length,
      withPhone: rows.filter((row) => row.phone).length,
      paid: paidMembers.length,
      activeTrials: trialUsers.filter((member) => member.status === "active").length,
      expiredUnpaidTrials: trialUsers.filter((member) => member.status === "expired-unpaid").length,
      convertedTrials: trialUsers.filter((member) => member.status === "converted").length,
      trialGateUsers: mongoRows.filter((user) => Number(user.trialGateViews || 0) > 0).length,
      trialCtaUsers: mongoRows.filter((user) => Number(user.trialCtaClicks || 0) > 0).length,
    },
    sourceCounts,
    engagement: {
      ...engagement,
      visitors: visitorResult.items,
      pagination: visitorResult.pagination,
    },
    liveReaders: liveResult.items,
    livePagination: liveResult.pagination,
    trend,
    members: memberResult.items,
    memberPagination: memberResult.pagination,
    paidMembers: paidResult.items,
    paidPagination: paidResult.pagination,
    trialUsers: trialResult.items,
    trialPagination: trialResult.pagination,
  };
}
