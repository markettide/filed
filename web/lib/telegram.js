/**
 * Telegram, for portfolio alerts.
 *
 * Three moving parts, and only the first needs explaining:
 *
 * 1. LINKING. A username alone is not permission to message somebody. The
 *    primary path uses Telegram Login with request-access="write"; Telegram
 *    asks the reader to approve messages and signs the returned Telegram id.
 *    verifyLoginPayload checks that signature before the id is stored. The
 *    older /start token path remains available to the webhook as a fallback.
 *
 * 2. SENDING. One HTTP call, no npm package.
 *
 * 3. FORMATTING. The same three things the dashboard card shows: what
 *    happened, the numbers, and a link to the PDF. A reader who cannot check
 *    the filing has to trust the summary, and the whole site is built on not
 *    asking that.
 */

import {
  consumeTelegramLink,
  createTelegramLink,
} from "./operational-state.js";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.telegram.org";

export function configured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export function botName() {
  // Accept either BotFather's @name form or the bare username. Keeping the
  // normalisation here prevents malformed t.me and Telegram Web URLs such as
  // #@@Markettide_bot when an environment value includes the leading @.
  return String(process.env.TELEGRAM_BOT_NAME || "")
    .trim()
    .replace(/^@+/, "");
}

/**
 * Verify the signed user record returned by Telegram's Login Widget.
 *
 * This is what makes the one-click connection safe: the browser cannot
 * choose a Telegram id for another person because every field is covered by
 * an HMAC derived from the bot token.  Old responses are rejected as well so
 * a captured login cannot be replayed later.
 */
export function verifyLoginPayload(payload, now = Date.now()) {
  if (!payload || typeof payload !== "object") return null;

  const token = String(process.env.TELEGRAM_BOT_TOKEN || "");
  const suppliedHash = String(payload.hash || "").toLowerCase();
  const id = String(payload.id || "").trim();
  const authDate = Number(payload.auth_date);
  if (!token || !id || !/^\d+$/.test(id) || !/^[a-f0-9]{64}$/.test(suppliedHash)) {
    return null;
  }
  if (!Number.isFinite(authDate)) return null;

  const ageSeconds = Math.floor(now / 1000) - authDate;
  if (ageSeconds < -60 || ageSeconds > 10 * 60) return null;

  const allowed = [
    "auth_date",
    "first_name",
    "id",
    "last_name",
    "photo_url",
    "username",
  ];
  const checkString = allowed
    .filter((key) => payload[key] !== undefined && payload[key] !== null)
    .map((key) => `${key}=${String(payload[key])}`)
    .sort()
    .join("\n");
  const secret = createHash("sha256").update(token).digest();
  const expected = createHmac("sha256", secret).update(checkString).digest();
  const supplied = Buffer.from(suppliedHash, "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return null;
  }

  return {
    chatId: id,
    username: String(payload.username || "").trim().replace(/^@+/, "") || null,
    firstName: String(payload.first_name || "").trim() || null,
    lastName: String(payload.last_name || "").trim() || null,
  };
}

/**
 * A token proving this reader asked to link, good for fifteen minutes.
 *
 * Telegram's start parameter allows only [A-Za-z0-9_-] and 64 characters, so
 * the email does not travel inside it. MongoDB stores the email behind a
 * random 32-character token and the webhook consumes that token once.
 */
export async function makeLinkToken(email) {
  return createTelegramLink(email);
}

/** The reader a token belongs to, or null if it is not one of ours. */
export async function readLinkToken(token) {
  return consumeTelegramLink(token);
}

/** The link a reader taps to connect Telegram. */
export async function deepLink(email) {
  const bot = botName();
  if (!bot) return null;
  const token = await makeLinkToken(email);
  if (!token) return null;
  return `https://t.me/${bot}?start=${token}`;
}

async function call(method, body) {
  const res = await fetch(`${API}/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!data?.ok) {
    throw new Error(
      `telegram ${method}: ${data?.description || res.status}`
    );
  }
  return data.result;
}

export async function sendMessage(chatId, text, options = {}) {
  return call("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    // The PDF link is the point of the message, so the preview card Telegram
    // would draw for it is just a second copy taking up the screen.
    link_preview_options: { is_disabled: true },
    ...options,
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * One filing, as a message.
 *
 * Kept close to the dashboard card on purpose - a reader who has seen the
 * site should recognise this, and a reader who has only seen this should not
 * be surprised by the site.
 */
export function formatFiling(row, stock) {
  const title = escapeHtml(stock?.name || row.company || "");
  const tag = escapeHtml(row.tag || row.category || "Update");
  const lines = [`<b>${title}</b>`, `${tag}${row.time ? ` · ${escapeHtml(row.time)}` : ""}`];

  const summary = String(row.summary || row.headline || "").trim();
  if (summary) lines.push("", escapeHtml(summary));

  const numbers = Array.isArray(row.key_numbers) ? row.key_numbers.slice(0, 4) : [];
  if (numbers.length) {
    lines.push("", ...numbers.map((n) => `• ${escapeHtml(n)}`));
  }

  if (row.pdf_url) {
    lines.push("", `<a href="${escapeHtml(row.pdf_url)}">Read the filing (PDF)</a>`);
  }

  return lines.join("\n");
}
