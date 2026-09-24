/** MongoDB-backed reader profiles. */

import { MongoClient } from "mongodb";

let clientPromise;
let indexesReady;

export function configured() {
  return Boolean(process.env.MONGODB_URI);
}

async function collection() {
  if (!configured()) throw new Error("MONGODB_URI is not configured");
  if (!clientPromise) {
    const client = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 6000,
    });
    clientPromise = client.connect().catch((error) => {
      // A short DNS/network interruption must not poison this server process
      // forever. Clear the cached rejection so the next request can reconnect.
      clientPromise = undefined;
      indexesReady = undefined;
      throw error;
    });
  }
  const client = await clientPromise;
  const users = client.db(process.env.MONGODB_DB || "market_tide").collection("users");
  if (!indexesReady) indexesReady = users.createIndex({ email: 1 }, { unique: true });
  await indexesReady;
  return users;
}

export async function findByEmail(email) {
  const users = await collection();
  return users.findOne(
    { email },
    {
      projection: {
        _id: 0,
        email: 1,
        name: 1,
        phone: 1,
        emailVerifiedAt: 1,
        createdAt: 1,
        briefSubscribed: 1,
        briefSubscribedAt: 1,
        kitSyncStatus: 1,
        subscriptionPlan: 1,
        subscriptionStatus: 1,
        subscriptionStartsAt: 1,
        subscriptionEndsAt: 1,
        latestPaymentOrderId: 1,
        premiumOrderIds: 1,
        trialStartedAt: 1,
        trialEndsAt: 1,
      },
    }
  );
}

/** Start the single card-free Premium trial available to each account. */
export async function startPremiumTrial(email, days = 7) {
  const users = await collection();
  const now = new Date();
  const endsAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const result = await users.updateOne(
    {
      email,
      $or: [
        { trialStartedAt: { $exists: false } },
        { trialStartedAt: null },
      ],
    },
    {
      $set: {
        trialStartedAt: now,
        trialEndsAt: endsAt,
        updatedAt: now,
      },
    }
  );

  const profile = await findByEmail(email);
  return { started: result.modifiedCount === 1, profile };
}

/** Record first-party trial interest for the private admin funnel. */
export async function recordTrialFunnel(email, event, path) {
  const users = await collection();
  const now = new Date();
  const field = event === "cta_click" ? "trialCtaClicks" : "trialGateViews";
  const atField = event === "cta_click" ? "trialLastCtaAt" : "trialLastGateAt";
  await users.updateOne(
    { email: String(email || "").trim().toLowerCase() },
    {
      $inc: { [field]: 1 },
      $set: { [atField]: now, trialLastInterestPath: String(path || "").slice(0, 80) },
    }
  );
}

/** Update the small set of identity fields a reader is allowed to manage. */
export async function updateUserProfile({ email, name, phone }) {
  const users = await collection();
  const now = new Date();
  await users.updateOne(
    { email },
    {
      $set: {
        name,
        phone,
        updatedAt: now,
      },
      $setOnInsert: { email, createdAt: now },
    },
    { upsert: true }
  );
  return findByEmail(email);
}

export async function saveVerifiedUser({ email, phone }) {
  const users = await collection();
  const now = new Date();
  const before = await users.findOne(
    { email },
    { projection: { _id: 0, emailVerifiedAt: 1, welcomeEmailSentAt: 1 } }
  );
  await users.updateOne(
    { email },
    {
      $set: {
        email,
        ...(phone ? { phone } : {}),
        emailVerifiedAt: now,
        lastLoginAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );
  return {
    email,
    phone: phone || null,
    firstVerification: !before?.emailVerifiedAt,
    shouldSendWelcome: !before?.welcomeEmailSentAt,
  };
}

export async function saveDirectUser({ email, phone }) {
  const users = await collection();
  const now = new Date();
  await users.updateOne(
    { email },
    {
      $set: { email, ...(phone ? { phone } : {}), lastLoginAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );
  return { email, phone: phone || null };
}

/** Store a community/interest lead without treating it as newsletter consent. */
export async function saveLeadUser({ email, phone = null, source = "unknown" }) {
  const users = await collection();
  const now = new Date();
  await users.updateOne(
    { email },
    {
      $set: {
        email,
        ...(phone ? { phone } : {}),
        leadUpdatedAt: now,
      },
      $addToSet: { acquisitionSources: source },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );
  return { email, phone, source };
}

export async function markWelcomeEmailSent(email, via = "gmail") {
  const users = await collection();
  await users.updateOne(
    { email },
    { $set: { welcomeEmailSentAt: new Date(), welcomeEmailVia: via } }
  );
}

/** Mark an email as subscribed without creating duplicate users. */
export async function subscribeUser({ email, phone = null, source = "brief" }) {
  const users = await collection();
  const now = new Date();
  const current = await users.findOne(
    { email },
    { projection: { _id: 0, briefSubscribed: 1 } }
  );
  const alreadySubscribed = Boolean(current?.briefSubscribed);

  await users.updateOne(
    { email },
    {
      $set: {
        email,
        ...(phone ? { phone } : {}),
        briefSubscribed: true,
        briefSubscriptionSource: source,
        briefSubscriptionUpdatedAt: now,
        updatedAt: now,
        ...(!alreadySubscribed ? { briefSubscribedAt: now } : {}),
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );

  return { email, alreadySubscribed };
}

/** Track whether a newsletter subscriber has reached Kit successfully. */
export async function markKitSync(email, status, detail = null) {
  const users = await collection();
  const now = new Date();
  await users.updateOne(
    { email },
    {
      $set: {
        kitSyncStatus: status,
        kitSyncAttemptedAt: now,
        ...(status === "synced" ? { kitSyncedAt: now } : {}),
        ...(detail ? { kitSyncDetail: String(detail).slice(0, 160) } : {}),
      },
      ...(detail ? {} : { $unset: { kitSyncDetail: "" } }),
    }
  );
}

/** Private admin view. Callers must enforce admin authentication first. */
export async function listUsersForAdmin(limit = 5000) {
  const users = await collection();
  return users.find(
    {},
    {
      projection: {
        _id: 0,
        email: 1,
        phone: 1,
        createdAt: 1,
        updatedAt: 1,
        emailVerifiedAt: 1,
        lastLoginAt: 1,
        briefSubscribed: 1,
        briefSubscribedAt: 1,
        briefSubscriptionUpdatedAt: 1,
        briefSubscriptionSource: 1,
        welcomeEmailSentAt: 1,
        welcomeEmailVia: 1,
        acquisitionSources: 1,
        leadUpdatedAt: 1,
        kitSyncStatus: 1,
        kitSyncAttemptedAt: 1,
        kitSyncedAt: 1,
        trialStartedAt: 1,
        trialEndsAt: 1,
        trialGateViews: 1,
        trialCtaClicks: 1,
        trialLastGateAt: 1,
        trialLastCtaAt: 1,
        trialLastInterestPath: 1,
        subscriptionPlan: 1,
        subscriptionStatus: 1,
        subscriptionStartsAt: 1,
        subscriptionEndsAt: 1,
        latestPaymentOrderId: 1,
        premiumOrderIds: 1,
      },
    }
  ).sort({ createdAt: -1 }).limit(Math.max(1, Math.min(Number(limit) || 5000, 5000))).toArray();
}

export async function closeUsersConnection() {
  if (!clientPromise) return;
  const client = await clientPromise;
  await client.close();
  clientPromise = undefined;
  indexesReady = undefined;
}
