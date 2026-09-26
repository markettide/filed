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

import crypto from "node:crypto";

const API = "https://api.telegram.org";
const LINK_TTL_SECONDS = 15 * 60;

export function configured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export function botName() {
  return process.env.TELEGRAM_BOT_NAME || "";
}

function sign(payload) {
  return crypto
    .createHmac("sha256", process.env.AUTH_SECRET)
    .update(`tg:${payload}`)
    .digest("base64url");
}

/**
 * A token proving this reader asked to link, good for fifteen minutes.
 *
 * Telegram's start parameter allows only [A-Za-z0-9_-] and 64 characters, so
 * the email cannot travel inside it. It carries a random id instead, and the
 * webhook looks the reader up by it.
 */
export function makeLinkToken(email) {
  if (!process.env.AUTH_SECRET) return null;
  const issued = Math.floor(Date.now() / 1000);
  const body = Buffer.from(`${email}|${issued}`).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** The reader a token belongs to, or null if it is not one of ours. */
export function readLinkToken(token) {
  if (!token || !process.env.AUTH_SECRET) return null;

  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;

  const body = token.slice(0, dot);
  const given = token.slice(dot + 1);
  const expected = sign(body);

  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const [email, issued] = Buffer.from(body, "base64url")
    .toString("utf8")
    .split("|");
  if (!email || !issued) return null;

  // The signature proves we wrote it. It does not prove it is still current -
  // a link forwarded to somebody else a week later must not work.
  if (Math.floor(Date.now() / 1000) - Number(issued) > LINK_TTL_SECONDS) {
    return null;
  }
  return email;
}

/** The link a reader taps to connect Telegram. */
export function deepLink(email) {
  const bot = botName();
  const token = makeLinkToken(email);
  if (!bot || !token) return null;
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
