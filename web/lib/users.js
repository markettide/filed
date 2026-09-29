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
        // The watchlist endpoint uses the same profile read to render alert
        // status. Keep these in the projection or a successfully linked bot
        // is stored in MongoDB but the page still appears disconnected.
        telegram: 1,
        alertsEnabled: 1,
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

/** Newsletter audience in the legacy export shape, now sourced from MongoDB. */
export async function listNewsletterSubscribers(limit = 10000) {
  const users = await collection();
  return users.find(
    { briefSubscribed: true },
    {
      projection: {
        _id: 0,
        email: 1,
        phone: 1,
        briefSubscribedAt: 1,
        briefSubscriptionUpdatedAt: 1,
        briefSubscriptionSource: 1,
      },
    }
  ).sort({ briefSubscribedAt: 1 }).limit(Math.max(1, Math.min(Number(limit) || 10000, 10000)))
    .toArray()
    .then((rows) => rows.map((row) => ({
      email: row.email,
      phone: row.phone || null,
      at: row.briefSubscribedAt || row.briefSubscriptionUpdatedAt || null,
      source: row.briefSubscriptionSource || "brief",
    })));
}

export async function countNewsletterSubscribers() {
  const users = await collection();
  return users.countDocuments({ briefSubscribed: true });
}

const TRIAL_FOLLOWUP_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
const REMINDER_CLAIM_TTL_MS = 20 * 60 * 1000;

function noPaidHistoryQuery() {
  return {
    $and: [
      {
        $or: [
          { latestPaymentOrderId: { $exists: false } },
          { latestPaymentOrderId: null },
          { latestPaymentOrderId: "" },
        ],
      },
      {
        $or: [
          { premiumOrderIds: { $exists: false } },
          { premiumOrderIds: { $size: 0 } },
        ],
      },
    ],
  };
}

/** Readers whose expired-trial sequence has a message due now. */
export async function listTrialReminderCandidates(now = new Date(), limit = 100) {
  const users = await collection();
  const followupCutoff = new Date(now.getTime() - TRIAL_FOLLOWUP_DELAY_MS);
  const lastDayCutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return users.find(
    {
      email: { $type: "string", $ne: "" },
      trialEndsAt: { $lte: lastDayCutoff },
      ...noPaidHistoryQuery(),
      $or: [
        {
          trialEndsAt: { $gt: now, $lte: lastDayCutoff },
          trialLastDayReminderSentAt: { $exists: false },
        },
        {
          trialEndsAt: { $lte: now },
          trialExpiryReminderSentAt: { $exists: false },
        },
        {
          trialExpiryReminderSentAt: { $type: "date", $lte: followupCutoff },
          trialFollowupReminderSentAt: { $exists: false },
        },
      ],
    },
    {
      projection: {
        _id: 0,
        email: 1,
        name: 1,
        trialStartedAt: 1,
        trialEndsAt: 1,
        trialExpiryReminderSentAt: 1,
        trialFollowupReminderSentAt: 1,
        latestPaymentOrderId: 1,
        premiumOrderIds: 1,
        subscriptionPlan: 1,
        subscriptionStatus: 1,
        subscriptionEndsAt: 1,
        trialLastDayReminderSentAt: 1,
      },
    }
  ).sort({ trialEndsAt: 1 }).limit(Math.max(1, Math.min(Number(limit) || 100, 250))).toArray();
}

function reminderFields(stage) {
  if (stage === "last-day") {
    return {
      sentAt: "trialLastDayReminderSentAt",
      providerId: "trialLastDayReminderProviderId",
      claimedAt: "trialLastDayReminderClaimedAt",
      attemptedAt: "trialLastDayReminderAttemptedAt",
      error: "trialLastDayReminderError",
    };
  }
  if (stage === "expired") {
    return {
      sentAt: "trialExpiryReminderSentAt",
      providerId: "trialExpiryReminderProviderId",
      claimedAt: "trialExpiryReminderClaimedAt",
      attemptedAt: "trialExpiryReminderAttemptedAt",
      error: "trialExpiryReminderError",
    };
  }
  if (stage === "followup") {
    return {
      sentAt: "trialFollowupReminderSentAt",
      providerId: "trialFollowupReminderProviderId",
      claimedAt: "trialFollowupReminderClaimedAt",
      attemptedAt: "trialFollowupReminderAttemptedAt",
      error: "trialFollowupReminderError",
    };
  }
  throw new Error("Unknown trial reminder stage");
}

/** Atomically reserve one reminder so overlapping cron runs cannot both send it. */
export async function claimTrialReminder({ email, trialEndsAt, stage, now = new Date() }) {
  const users = await collection();
  const fields = reminderFields(stage);
  const staleBefore = new Date(now.getTime() - REMINDER_CLAIM_TTL_MS);
  const stagePrerequisite = stage === "followup"
    ? { trialExpiryReminderSentAt: { $type: "date" } }
    : {};
  const result = await users.updateOne(
    {
      email,
      trialEndsAt: new Date(trialEndsAt),
      ...noPaidHistoryQuery(),
      ...stagePrerequisite,
      [fields.sentAt]: { $exists: false },
      $or: [
        { [fields.claimedAt]: { $exists: false } },
        { [fields.claimedAt]: { $lt: staleBefore } },
      ],
    },
    {
      $set: {
        [fields.claimedAt]: now,
        [fields.attemptedAt]: now,
      },
      $unset: { [fields.error]: "" },
    }
  );
  return result.modifiedCount === 1;
}

export async function completeTrialReminder({ email, trialEndsAt, stage, providerId, now = new Date() }) {
  const users = await collection();
  const fields = reminderFields(stage);
  await users.updateOne(
    { email, trialEndsAt: new Date(trialEndsAt), [fields.sentAt]: { $exists: false } },
    {
      $set: {
        [fields.sentAt]: now,
        ...(providerId ? { [fields.providerId]: String(providerId).slice(0, 160) } : {}),
      },
      $unset: { [fields.claimedAt]: "", [fields.error]: "" },
    }
  );
}

export async function releaseTrialReminder({ email, trialEndsAt, stage, error }) {
  const users = await collection();
  const fields = reminderFields(stage);
  await users.updateOne(
    { email, trialEndsAt: new Date(trialEndsAt), [fields.sentAt]: { $exists: false } },
    {
      $set: { [fields.error]: String(error || "delivery failed").slice(0, 300) },
      $unset: { [fields.claimedAt]: "" },
    }
  );
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
        portfolio: 1,
        portfolioOverflow: 1,
        "telegram.chatId": 1,
        "telegram.username": 1,
        alertsEnabled: 1,
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
