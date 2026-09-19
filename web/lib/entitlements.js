import { currentUser } from "./session.js";
import { findByEmail } from "./users.js";

export const TRIAL_DAYS = 7;

export function emailFromSession(request) {
  const user = currentUser(request);
  if (!user || user.channel !== "email") return null;
  return user.id.slice(user.id.indexOf(":") + 1).trim().toLowerCase();
}

export function accessForProfile(profile, now = new Date()) {
  const paidEndsAt = profile?.subscriptionEndsAt
    ? new Date(profile.subscriptionEndsAt)
    : null;
  const trialEndsAt = profile?.trialEndsAt ? new Date(profile.trialEndsAt) : null;
  const paidActive =
    profile?.subscriptionPlan === "premium" &&
    profile?.subscriptionStatus === "active" &&
    paidEndsAt instanceof Date &&
    !Number.isNaN(paidEndsAt.valueOf()) &&
    paidEndsAt > now;
  const trialActive =
    trialEndsAt instanceof Date &&
    !Number.isNaN(trialEndsAt.valueOf()) &&
    trialEndsAt > now;
  const trialStarted = Boolean(profile?.trialStartedAt || profile?.trialEndsAt);
  const hasPaidHistory = Boolean(
    profile?.latestPaymentOrderId || profile?.premiumOrderIds?.length
  );

  return {
    level: paidActive ? "paid" : trialActive ? "trial" : "free",
    premium: paidActive || trialActive,
    paidActive,
    trialActive,
    trialAvailable: !trialStarted && !hasPaidHistory,
    trialStartedAt: profile?.trialStartedAt || null,
    trialEndsAt: profile?.trialEndsAt || null,
    paidStartsAt: profile?.subscriptionStartsAt || null,
    paidEndsAt: profile?.subscriptionEndsAt || null,
  };
}

export async function accessForRequest(request) {
  const email = emailFromSession(request);
  if (!email) return { email: null, profile: null, access: accessForProfile(null) };
  const profile = await findByEmail(email);
  return { email, profile, access: accessForProfile(profile) };
}

/** Returns a Response when access is blocked, otherwise the entitlement context. */
export async function requirePremiumAccess(request) {
  const context = await accessForRequest(request);
  if (!context.email) {
    return Response.json(
      { error: "Please sign in to use this Premium feature.", code: "sign_in_required" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } }
    );
  }
  if (!context.access.premium) {
    return Response.json(
      {
        error: context.access.trialAvailable
          ? "Start your free seven-day trial to use this Premium feature."
          : "Your free trial has ended. Choose Premium to continue.",
        code: context.access.trialAvailable ? "trial_available" : "premium_required",
        access: context.access,
      },
      { status: 403, headers: { "Cache-Control": "private, no-store" } }
    );
  }
  return context;
}
