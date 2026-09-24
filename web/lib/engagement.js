/** First-party, privacy-limited session analytics for the private admin view. */

import { MongoClient } from "mongodb";

const RETENTION_SECONDS = 60 * 60 * 24 * 90;
let clientPromise;
let indexesReady;
let trafficIndexesReady;

const TRAFFIC_ID = "traffic";
const LIVE_WINDOW_SECONDS = 300;

function dateInIndia(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

async function collection() {
  if (!process.env.MONGODB_URI) return null;
  if (!clientPromise) {
    clientPromise = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 6000,
    }).connect();
  }
  const client = await clientPromise;
  const sessions = client
    .db(process.env.MONGODB_DB || "market_tide")
    .collection("visit_sessions");
  if (!indexesReady) {
    indexesReady = Promise.all([
      sessions.createIndex({ sessionKey: 1 }, { unique: true }),
      sessions.createIndex({ date: 1, lastSeenAt: -1 }),
      sessions.createIndex({ email: 1, date: 1 }),
      sessions.createIndex({ lastSeenAt: 1 }, { expireAfterSeconds: RETENTION_SECONDS }),
    ]);
  }
  await indexesReady;
  return sessions;
}

async function trafficCollections() {
  if (!process.env.MONGODB_URI) return null;
  if (!clientPromise) {
    clientPromise = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 6000,
    }).connect();
  }
  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || "market_tide");
  const metrics = db.collection("site_metrics");
  const visitors = db.collection("site_visitors");
  const sessions = db.collection("visit_sessions");
  if (!trafficIndexesReady) {
    trafficIndexesReady = Promise.all([
      visitors.createIndex({ lastSeenAt: -1 }),
      sessions.createIndex({ visitorId: 1, startedAt: 1 }),
    ]);
  }
  await trafficIndexesReady;
  return { metrics, visitors, sessions };
}

async function redisTrafficBaseline() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  try {
    const response = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["GET", "mt:visits:total"],
        ["PFCOUNT", "mt:visits:uniq"],
      ]),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const result = await response.json();
    if (!Array.isArray(result)) return null;
    return {
      total: Math.max(0, Number(result[0]?.result || 0)),
      unique: Math.max(0, Number(result[1]?.result || 0)),
    };
  } catch {
    return null;
  }
}

/**
 * Capture Redis' lifetime counters exactly once. The Redis HyperLogLog cannot
 * expose its member IDs, so its unique count becomes an immutable baseline;
 * MongoDB adds only genuinely new browsers after the cut-over.
 */
async function ensureTrafficBaseline(metrics) {
  let current = await metrics.findOne({ _id: TRAFFIC_ID });
  if (current?.baselineCapturedAt) return current;

  const baseline = await redisTrafficBaseline();
  if (!baseline) return current;

  const capturedAt = new Date();
  try {
    await metrics.updateOne(
      { _id: TRAFFIC_ID, baselineCapturedAt: { $exists: false } },
      {
        $set: {
          baselineTotal: baseline.total,
          baselineUnique: baseline.unique,
          baselineCapturedAt: capturedAt,
          updatedAt: capturedAt,
        },
        $setOnInsert: { totalAfterBaseline: 0, uniqueAfterBaseline: 0 },
      },
      { upsert: true }
    );
  } catch (error) {
    // Two cold server instances may capture the same baseline together. The
    // unique _id makes one win; the loser simply reads the stored baseline.
    if (error?.code !== 11000) throw error;
  }
  current = await metrics.findOne({ _id: TRAFFIC_ID });
  return current;
}

/** Record public traffic without spending Redis commands. */
export async function recordTraffic({ visitorId, event }) {
  const collections = await trafficCollections();
  if (!collections || !visitorId) return false;
  const { metrics, visitors, sessions } = collections;
  const baseline = await ensureTrafficBaseline(metrics);
  const now = new Date();

  const visitor = await visitors.updateOne(
    { _id: visitorId },
    { $set: { lastSeenAt: now }, $setOnInsert: { firstSeenAt: now } },
    { upsert: true }
  );

  let uniqueIncrement = 0;
  if (visitor.upsertedCount) {
    // Session analytics was already in MongoDB before this migration. If the
    // browser appeared before the Redis baseline was captured, it is already
    // included in baselineUnique and must not be counted twice.
    const wasInBaseline = baseline?.baselineCapturedAt
      ? await sessions.findOne(
          { visitorId, startedAt: { $lt: new Date(baseline.baselineCapturedAt) } },
          { projection: { _id: 1 } }
        )
      : null;
    uniqueIncrement = wasInBaseline ? 0 : 1;
  }

  const totalIncrement = event === "pageview" ? 1 : 0;
  if (totalIncrement || uniqueIncrement) {
    await metrics.updateOne(
      { _id: TRAFFIC_ID },
      {
        $inc: {
          totalAfterBaseline: totalIncrement,
          uniqueAfterBaseline: uniqueIncrement,
        },
        $set: { updatedAt: now },
        $setOnInsert: { baselineTotal: 0, baselineUnique: 0 },
      },
      { upsert: true }
    );
  }
  return true;
}

/** Lifetime counters plus readers active during the same five-minute window. */
export async function trafficTotals() {
  const collections = await trafficCollections();
  if (!collections) return { total: 0, unique: 0, live: 0, baselineReady: false };
  const { metrics, sessions } = collections;
  const row = await ensureTrafficBaseline(metrics);
  const cutoff = new Date(Date.now() - LIVE_WINDOW_SECONDS * 1000);
  const liveVisitors = await sessions.distinct("visitorId", {
    lastSeenAt: { $gte: cutoff },
    active: { $ne: false },
  });
  return {
    total: Math.max(0, Number(row?.baselineTotal || 0))
      + Math.max(0, Number(row?.totalAfterBaseline || 0)),
    unique: Math.max(0, Number(row?.baselineUnique || 0))
      + Math.max(0, Number(row?.uniqueAfterBaseline || 0)),
    live: liveVisitors.filter(Boolean).length,
    baselineReady: Boolean(row?.baselineCapturedAt),
  };
}

export async function recordEngagement({ visitorId, sessionId, email, path, event }) {
  const sessions = await collection();
  if (!sessions || !visitorId || !sessionId) return false;

  const now = new Date();
  const date = dateInIndia(now);
  const sessionKey = `${sessionId}:${date}`;
  const existing = await sessions.findOne(
    { sessionKey },
    { projection: { _id: 0, lastSeenAt: 1 } }
  );
  const elapsed = existing?.lastSeenAt && event !== "resume"
    ? Math.max(0, Math.min(90, Math.round((now - new Date(existing.lastSeenAt)) / 1000)))
    : 0;
  const pageView = event === "pageview" ? 1 : 0;

  await sessions.updateOne(
    { sessionKey },
    {
      $set: {
        visitorId,
        ...(email ? { email } : {}),
        date,
        lastSeenAt: now,
        active: event !== "end",
        ...(path ? { currentPath: path } : {}),
      },
      $setOnInsert: { sessionKey, sessionId, startedAt: now },
      $inc: { durationSeconds: elapsed, pageViews: pageView },
      ...(pageView && path ? { $addToSet: { pages: path } } : {}),
    },
    { upsert: true }
  );
  return true;
}

export async function dailyEngagement(requestedDate) {
  const sessions = await collection();
  const date = validDate(requestedDate) ? requestedDate : dateInIndia();
  if (!sessions) return empty(date);

  const records = await sessions.find(
    { date },
    {
      projection: {
        _id: 0,
        email: 1,
        visitorId: 1,
        startedAt: 1,
        lastSeenAt: 1,
        durationSeconds: 1,
        pageViews: 1,
        pages: 1,
      },
    }
  ).limit(10000).toArray();

  const visitors = new Map();
  const pageCounts = {};
  let totalSeconds = 0;
  let totalPageViews = 0;

  for (const record of records) {
    const key = record.email || `browser:${record.visitorId}`;
    if (!visitors.has(key)) {
      visitors.set(key, {
        key,
        email: record.email || null,
        visitorId: record.visitorId,
        sessions: 0,
        pageViews: 0,
        durationSeconds: 0,
        longestSessionSeconds: 0,
        firstSeenAt: null,
        lastSeenAt: null,
        pages: new Set(),
        sessionDetails: [],
      });
    }
    const visitor = visitors.get(key);
    const seconds = Math.max(0, Number(record.durationSeconds || 0));
    const views = Math.max(0, Number(record.pageViews || 0));
    visitor.sessions += 1;
    visitor.pageViews += views;
    visitor.durationSeconds += seconds;
    visitor.longestSessionSeconds = Math.max(visitor.longestSessionSeconds, seconds);
    const started = record.startedAt ? new Date(record.startedAt).toISOString() : null;
    const seen = record.lastSeenAt ? new Date(record.lastSeenAt).toISOString() : null;
    if (started && (!visitor.firstSeenAt || started < visitor.firstSeenAt)) visitor.firstSeenAt = started;
    if (seen && (!visitor.lastSeenAt || seen > visitor.lastSeenAt)) visitor.lastSeenAt = seen;
    visitor.sessionDetails.push({
      startedAt: started,
      lastSeenAt: seen,
      durationSeconds: seconds,
      pageViews: views,
      pages: record.pages || [],
    });
    for (const page of record.pages || []) {
      visitor.pages.add(page);
      pageCounts[page] = (pageCounts[page] || 0) + 1;
    }
    totalSeconds += seconds;
    totalPageViews += views;
  }

  const rows = [...visitors.values()].map((visitor) => ({
    ...visitor,
    averageSessionSeconds: visitor.sessions
      ? Math.round(visitor.durationSeconds / visitor.sessions)
      : 0,
    pages: [...visitor.pages],
    sessionDetails: visitor.sessionDetails.sort((a, b) =>
      String(a.startedAt || "").localeCompare(String(b.startedAt || ""))
    ),
  })).sort((a, b) => b.durationSeconds - a.durationSeconds || b.pageViews - a.pageViews);

  return {
    date,
    totals: {
      visitors: rows.length,
      identifiedVisitors: rows.filter((row) => row.email).length,
      sessions: records.length,
      pageViews: totalPageViews,
      durationSeconds: totalSeconds,
      averageSessionSeconds: records.length ? Math.round(totalSeconds / records.length) : 0,
    },
    topPages: Object.entries(pageCounts)
      .map(([path, sessions]) => ({ path, sessions }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 10),
    visitors: rows,
  };
}

export async function liveEngagement(windowSeconds = 300) {
  const sessions = await collection();
  if (!sessions) return [];

  const now = new Date();
  const cutoff = new Date(now.getTime() - Math.max(60, windowSeconds) * 1000);
  const records = await sessions.find(
    { lastSeenAt: { $gte: cutoff }, active: { $ne: false } },
    {
      projection: {
        _id: 0,
        sessionKey: 1,
        email: 1,
        visitorId: 1,
        startedAt: 1,
        lastSeenAt: 1,
        durationSeconds: 1,
        pageViews: 1,
        currentPath: 1,
        pages: 1,
      },
    }
  ).sort({ lastSeenAt: -1 }).limit(1000).toArray();

  return records.map((record) => {
    const lastSeenAt = record.lastSeenAt ? new Date(record.lastSeenAt) : now;
    const uncountedSeconds = Math.max(0, Math.min(90, Math.round((now - lastSeenAt) / 1000)));
    return {
      key: record.sessionKey,
      email: record.email || null,
      visitorId: record.visitorId,
      startedAt: record.startedAt ? new Date(record.startedAt).toISOString() : null,
      lastSeenAt: lastSeenAt.toISOString(),
      readingSeconds: Math.max(0, Number(record.durationSeconds || 0)) + uncountedSeconds,
      pageViews: Math.max(0, Number(record.pageViews || 0)),
      currentPath: record.currentPath || (record.pages || []).at(-1) || "/",
    };
  });
}

export async function engagementTrend(days = 30) {
  const sessions = await collection();
  const safeDays = Math.max(7, Math.min(Number(days) || 30, 90));
  const dates = Array.from({ length: safeDays }, (_, index) => {
    const value = new Date(Date.now() - (safeDays - 1 - index) * 86400000);
    return dateInIndia(value);
  });
  if (!sessions) return dates.map(emptyTrendDay);

  const records = await sessions.find(
    { date: { $gte: dates[0], $lte: dates.at(-1) } },
    { projection: { _id: 0, date: 1, email: 1, visitorId: 1, durationSeconds: 1, pageViews: 1 } }
  ).limit(100000).toArray();
  const daysByDate = new Map(dates.map((date) => [date, { ...emptyTrendDay(date), visitorKeys: new Set() }]));

  for (const record of records) {
    const day = daysByDate.get(record.date);
    if (!day) continue;
    day.sessions += 1;
    day.pageViews += Math.max(0, Number(record.pageViews || 0));
    day.durationSeconds += Math.max(0, Number(record.durationSeconds || 0));
    day.visitorKeys.add(record.email || `browser:${record.visitorId}`);
    if (record.email) day.identifiedSessionCount += 1;
  }

  return dates.map((date) => {
    const day = daysByDate.get(date);
    const { visitorKeys, identifiedSessionCount, ...result } = day;
    return {
      ...result,
      visitors: visitorKeys.size,
      identifiedSessionCount,
      averageSessionSeconds: day.sessions ? Math.round(day.durationSeconds / day.sessions) : 0,
    };
  });
}

export async function engagementSessionHistory(days = 90) {
  const sessions = await collection();
  if (!sessions) return [];
  const safeDays = Math.max(1, Math.min(Number(days) || 90, 90));
  const firstDate = dateInIndia(new Date(Date.now() - (safeDays - 1) * 86400000));
  return sessions.find(
    { date: { $gte: firstDate } },
    {
      projection: {
        _id: 0, date: 1, sessionKey: 1, email: 1, visitorId: 1, startedAt: 1,
        lastSeenAt: 1, durationSeconds: 1, pageViews: 1, currentPath: 1, pages: 1,
      },
    }
  ).sort({ date: -1, startedAt: -1 }).limit(100000).toArray();
}

function emptyTrendDay(date) {
  return {
    date,
    visitors: 0,
    sessions: 0,
    pageViews: 0,
    durationSeconds: 0,
    averageSessionSeconds: 0,
    identifiedSessionCount: 0,
  };
}

function empty(date) {
  return {
    date,
    totals: {
      visitors: 0,
      identifiedVisitors: 0,
      sessions: 0,
      pageViews: 0,
      durationSeconds: 0,
      averageSessionSeconds: 0,
    },
    topPages: [],
    visitors: [],
  };
}
