const DAY_MS = 24 * 60 * 60 * 1000;

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function trialSummary(user, now = new Date()) {
  const startedAt = validDate(user?.trialStartedAt);
  const endsAt = validDate(user?.trialEndsAt);
  if (!startedAt || !endsAt) return null;

  const hasPaidPlan = Boolean(
    user?.latestPaymentOrderId ||
    (Array.isArray(user?.premiumOrderIds) && user.premiumOrderIds.length)
  );
  const active = endsAt > now;
  const status = hasPaidPlan ? "converted" : active ? "active" : "expired-unpaid";

  return {
    startedAt: startedAt.toISOString(),
    endsAt: endsAt.toISOString(),
    daysLeft: active ? Math.max(1, Math.ceil((endsAt - now) / DAY_MS)) : 0,
    daysSinceEnd: active ? 0 : Math.max(0, Math.floor((now - endsAt) / DAY_MS)),
    status,
    targetable: status === "expired-unpaid",
  };
}
