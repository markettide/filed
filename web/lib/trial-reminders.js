/** Automated conversion emails for readers whose seven-day trial has ended. */

import crypto from "node:crypto";
import { accessForProfile } from "./entitlements.js";
import { sendTrialReminderEmail } from "./notify.js";
import {
  claimTrialReminder,
  completeTrialReminder,
  listTrialReminderCandidates,
  releaseTrialReminder,
} from "./users.js";

export const TRIAL_FOLLOWUP_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const PRICING_URL = "https://markettide.in/pricing";

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hasPaidHistory(profile) {
  return Boolean(
    profile?.latestPaymentOrderId
    || (Array.isArray(profile?.premiumOrderIds) && profile.premiumOrderIds.length)
  );
}

/** The next due message, or null when the reader should receive nothing. */
export function reminderStageForProfile(profile, now = new Date()) {
  const trialEndsAt = validDate(profile?.trialEndsAt);
  if (!trialEndsAt || hasPaidHistory(profile)) return null;
  if (accessForProfile(profile, now).paidActive) return null;
  if (trialEndsAt > now) {
    const lastDayStartsAt = new Date(trialEndsAt.getTime() - DAY_MS);
    return lastDayStartsAt <= now && !profile?.trialLastDayReminderSentAt
      ? "last-day"
      : null;
  }
  if (!profile?.trialExpiryReminderSentAt) return "expired";

  const firstSentAt = validDate(profile.trialExpiryReminderSentAt);
  if (!firstSentAt) return null;
  const followupDueAt = new Date(firstSentAt.getTime() + TRIAL_FOLLOWUP_DAYS * DAY_MS);
  if (followupDueAt <= now && !profile?.trialFollowupReminderSentAt) return "followup";
  return null;
}

function firstName(value) {
  const clean = String(value || "").trim().split(/\s+/)[0] || "there";
  return clean.slice(0, 50);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function messageKey(email, trialEndsAt, stage) {
  const fingerprint = crypto
    .createHash("sha256")
    .update(`${String(email).trim().toLowerCase()}|${new Date(trialEndsAt).toISOString()}|${stage}`)
    .digest("hex")
    .slice(0, 40);
  return `market-tide/trial-${stage}/${fingerprint}`;
}

function emailShell({ greeting, lead, body, bullets, cta, closing }) {
  const bulletHtml = bullets.map((item) => `<li style="margin:0 0 9px">${item}</li>`).join("");
  return '<div style="max-width:620px;margin:0 auto;padding:24px;font-family:Arial,sans-serif;color:#17191d;line-height:1.65">'
    + `<p>${greeting}</p><p><strong>${lead}</strong></p>${body}`
    + `<ul style="padding-left:22px;margin:20px 0">${bulletHtml}</ul>`
    + `<p style="margin:26px 0"><a href="${PRICING_URL}" style="display:inline-block;padding:13px 20px;border-radius:10px;background:#2563eb;color:#fff;text-decoration:none;font-weight:700">${cta}</a></p>`
    + `<p>${closing}</p>`
    + '<p>Regards,<br><strong>Market Tide Team</strong><br><a href="mailto:market.tide27@gmail.com">market.tide27@gmail.com</a><br><a href="tel:+918200440146">+91 82004 40146</a><br><a href="https://markettide.in">markettide.in</a></p>'
    + '<p style="font-size:12px;color:#68707c">Market Tide summarises public filings and does not provide investment advice. Reply with “Unsubscribe” if you do not want to receive these emails.</p></div>';
}

export function trialReminderMessage(profile, stage) {
  const name = firstName(profile?.name);
  const greetingText = `Hi ${name},`;
  const greetingHtml = `Hi ${escapeHtml(name)},`;
  const commonFooter = "Regards,\nMarket Tide Team\nmarket.tide27@gmail.com\n+91 82004 40146\nhttps://markettide.in\n\nReply with Unsubscribe if you do not want to receive these emails.\n";

  if (stage === "last-day") {
    const bullets = [
      "The complete NSE and BSE announcement dashboard",
      "A Watchlist of up to 50 companies",
      "Instant Telegram filing alerts",
      "Insider trading information",
      "Bulk and block deal tracking",
      "Advanced filters, Excel exports, filing summaries and original PDFs",
    ];
    return {
      subject: "Your Market Tide Premium trial ends tomorrow",
      idempotencyKey: messageKey(profile.email, profile.trialEndsAt, stage),
      text:
        `${greetingText}\n\nThis is a quick reminder that today is the final day of your 7-day Market Tide Premium trial.\n\nStarting tomorrow, you will no longer have access to:\n\n`
        + bullets.map((item) => `• ${item}`).join("\n")
        + "\n\nYour free Market Tide account will remain active. You can continue receiving the morning newsletter and keep up to five companies in your Watchlist.\n\n"
        + "To continue using every Premium feature without interruption, upgrade for ₹299 for three months. It is a one-time payment with no automatic renewal.\n\n"
        + `Keep your Premium access: ${PRICING_URL}\n\nContinue following the companies that matter to you without spending hours reading exchange filings.\n\n${commonFooter}`,
      html: emailShell({
        greeting: greetingHtml,
        lead: "Today is the final day of your 7-day Market Tide Premium trial.",
        body: "<p>Starting tomorrow, you will no longer have access to:</p>",
        bullets,
        cta: "Keep your Premium access",
        closing: "Your free morning newsletter and first five Watchlist companies will remain active.<br><br>Continue every Premium feature without interruption for <strong>₹299 for three months</strong>, with no automatic renewal.",
      }),
    };
  }

  if (stage === "expired") {
    const bullets = [
      "The complete NSE and BSE announcement dashboard",
      "A Watchlist of up to 50 companies",
      "Instant Telegram filing alerts",
      "Insider trading information",
      "Bulk and block deal tracking",
      "Filing summaries, key numbers, original PDFs and Excel exports",
    ];
    return {
      subject: "Your Market Tide trial has ended — keep your alerts active",
      idempotencyKey: messageKey(profile.email, profile.trialEndsAt, stage),
      text:
        `${greetingText}\n\nYour 7-day Market Tide Premium trial has now ended.\n\nDuring your trial, you had access to:\n\n`
        + bullets.map((item) => `• ${item}`).join("\n")
        + "\n\nYour free account remains active. You can continue receiving the morning newsletter and keep up to five companies in your Watchlist. Telegram alerts and the other Premium features are now unavailable.\n\n"
        + "Continue with Market Tide Premium for ₹299 for three months, with no automatic renewal.\n\n"
        + `Restore Premium access: ${PRICING_URL}\n\nStay informed without spending hours reading exchange filings.\n\n${commonFooter}`,
      html: emailShell({
        greeting: greetingHtml,
        lead: "Your 7-day Market Tide Premium trial has now ended.",
        body: "<p>During your trial, you had access to:</p>",
        bullets,
        cta: "Restore Premium access",
        closing: "<strong>Continue for ₹299 for three months</strong>, with no automatic renewal. Your free morning newsletter and first five Watchlist companies remain active.",
      }),
    };
  }

  if (stage === "followup") {
    const bullets = [
      "Follow up to 50 companies",
      "Receive important filing alerts directly on Telegram",
      "Access the complete announcement dashboard",
      "Track insider transactions and bulk deals",
      "Read clear summaries with the important numbers",
      "Open original exchange filings and export your research",
    ];
    return {
      subject: "The companies you follow are still filing updates",
      idempotencyKey: messageKey(profile.email, profile.trialEndsAt, stage),
      text:
        `${greetingText}\n\nIt has been one week since your Market Tide Premium trial ended.\n\nImportant company announcements continue to arrive every day, but your Premium dashboard and Telegram filing alerts are currently inactive.\n\nWith Market Tide Premium, you can once again:\n\n`
        + bullets.map((item) => `• ${item}`).join("\n")
        + "\n\nPremium costs ₹299 for three months. It is a one-time payment with no automatic renewal—less than ₹4 per day.\n\n"
        + `Reactivate Market Tide Premium: ${PRICING_URL}\n\nYour free newsletter and five-company Watchlist will continue even if you decide not to upgrade.\n\n${commonFooter}`,
      html: emailShell({
        greeting: greetingHtml,
        lead: "It has been one week since your Market Tide Premium trial ended.",
        body: "<p>Important company announcements continue to arrive every day, but your Premium dashboard and Telegram filing alerts are currently inactive.</p><p>With Market Tide Premium, you can once again:</p>",
        bullets,
        cta: "Reactivate Market Tide Premium",
        closing: "<strong>Premium is ₹299 for three months</strong>—a one-time payment with no automatic renewal. Your free newsletter and five-company Watchlist will continue if you do not upgrade.",
      }),
    };
  }

  throw new Error("Unknown trial reminder stage");
}

export async function processTrialReminders({
  now = new Date(),
  limit = 100,
  dryRun = false,
  services = {},
} = {}) {
  const list = services.list || listTrialReminderCandidates;
  const claim = services.claim || claimTrialReminder;
  const send = services.send || sendTrialReminderEmail;
  const complete = services.complete || completeTrialReminder;
  const release = services.release || releaseTrialReminder;
  const candidates = await list(now, limit);
  const result = {
    checked: candidates.length,
    due: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    stages: { "last-day": 0, expired: 0, followup: 0 },
  };

  for (const profile of candidates) {
    const stage = reminderStageForProfile(profile, now);
    if (!stage) {
      result.skipped += 1;
      continue;
    }
    result.due += 1;
    result.stages[stage] += 1;
    if (dryRun) continue;

    const reservation = { email: profile.email, trialEndsAt: profile.trialEndsAt, stage, now };
    if (!(await claim(reservation))) {
      result.skipped += 1;
      continue;
    }

    try {
      const message = trialReminderMessage(profile, stage);
      const delivery = await send({ to: profile.email, ...message });
      if (!delivery?.sent) throw new Error(delivery?.reason || "Email was not accepted");
      await complete({ ...reservation, providerId: delivery.id });
      result.sent += 1;
    } catch (error) {
      result.failed += 1;
      await release({ ...reservation, error: error.message || error });
      console.error(`[trial reminders] ${stage} for ${profile.email}:`, error.message || error);
    }
  }

  return result;
}
