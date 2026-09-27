/**
 * Telegram, for portfolio alerts.
 *
 * Three moving parts, and only the first needs explaining:
 *
 * 1. LINKING. We cannot message a reader until they have messaged the bot -
 *    Telegram requires that, and it is the reason a "just paste your username"
 *    flow cannot work. So the site hands out a deep link,
 *    https://t.me/<bot>?start=<token>, the reader taps it, Telegram sends the
 *    bot "/start <token>", and the webhook below matches the token back to
 *    the account and stores the chat id. The token is a signed, short-lived
 *    statement that a particular signed-in reader asked for this - it is not
 *    a secret to guard, it is a claim to verify, which is the same reasoning
 *    as the session cookie.
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

const API = "https://api.telegram.org";

export function configured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export function botName() {
  return process.env.TELEGRAM_BOT_NAME || "";
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
