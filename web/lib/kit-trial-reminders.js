/** Deliver an individual trial reminder through a tightly scoped Kit broadcast. */

import { configured as kitConfigured, upsertSubscriber } from "./kit.js";

const API = "https://api.kit.com/v4";
const DEFAULT_FROM_EMAIL = "brief@markettide.in";

function headers() {
  return {
    "X-Kit-Api-Key": process.env.KIT_API_KEY,
    "Content-Type": "application/json",
  };
}

async function kitRequest(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { ...headers(), ...(options.headers || {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 240);
    throw new Error(`Kit ${response.status}: ${detail}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function reminderTagName(idempotencyKey) {
  const [, kind = "reminder", fingerprint = "unknown"] = String(idempotencyKey || "").split("/");
  return `Market Tide ${kind} ${fingerprint}`.slice(0, 100);
}

async function existingBroadcast(description) {
  const body = await kitRequest("/broadcasts?per_page=100", { method: "GET" });
  const broadcast = (body?.broadcasts || []).find((item) => item?.description === description);
  return broadcast?.id ? broadcast : null;
}

/**
 * Kit broadcasts only support tag/segment audiences, not a raw recipient email.
 * A deterministic one-person tag keeps each reminder private and makes retries
 * discover the already-created broadcast instead of scheduling a duplicate.
 */
export async function sendKitTrialReminder({ to, subject, html, idempotencyKey }) {
  if (!kitConfigured()) return { sent: false, reason: "Kit not configured" };
  if (!to || !subject || !html || !idempotencyKey) {
    throw new Error("Kit trial reminder is missing required delivery fields.");
  }

  const description = `Market Tide ${idempotencyKey}`;
  const prior = await existingBroadcast(description);
  if (prior) return { sent: true, id: prior.id, reused: true };

  await upsertSubscriber(to);
  const tagBody = await kitRequest("/tags", {
    method: "POST",
    body: JSON.stringify({ name: reminderTagName(idempotencyKey) }),
  });
  const tag = tagBody?.tag || tagBody;
  if (!tag?.id) throw new Error("Kit did not return a trial reminder tag ID.");

  await kitRequest(`/tags/${tag.id}/subscribers`, {
    method: "POST",
    body: JSON.stringify({ email_address: to }),
  });

  // Leave time for Kit's subscriber/tag updates to propagate before audience resolution.
  const sendAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  const body = await kitRequest("/broadcasts", {
    method: "POST",
    body: JSON.stringify({
      subject,
      preview_text: "An update about your Market Tide Premium trial.",
      description,
      content: html,
      public: false,
      published_at: new Date().toISOString(),
      send_at: sendAt,
      email_address: process.env.KIT_FROM_EMAIL || DEFAULT_FROM_EMAIL,
      subscriber_filter: [{
        all: [{ type: "tag", ids: [tag.id] }],
      }],
    }),
  });
  const broadcast = body?.broadcast || body;
  if (!broadcast?.id) throw new Error("Kit accepted the reminder without returning a broadcast ID.");
  return { sent: true, id: broadcast.id, sendAt: broadcast.send_at || sendAt };
}

