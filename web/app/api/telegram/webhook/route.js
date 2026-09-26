/**
 * Where Telegram delivers messages sent to the bot.
 *
 *   POST /api/telegram/webhook
 *
 * Only one message matters: "/start <token>", which is what tapping the deep
 * link sends. The token says which signed-in reader asked to link, and the
 * update says which chat to reply to - together they are the connection.
 *
 * This endpoint is public, because Telegram has to be able to reach it, so it
 * cannot trust its caller by network position. Telegram lets us register a
 * secret when we set the webhook up and sends it back in a header on every
 * delivery; that is what is checked below. Without it anyone who found the
 * URL could post an update claiming any chat id they liked, and the next
 * alert for that reader would go to them.
 *
 * Registering the webhook, once, after deploying:
 *
 *   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
 *     -d url=https://www.markettide.in/api/telegram/webhook \
 *     -d secret_token=<TELEGRAM_WEBHOOK_SECRET>
 */

import crypto from "node:crypto";
import { readLinkToken, sendMessage, configured } from "../../../../lib/telegram";
import { setTelegram, listPortfolio } from "../../../../lib/portfolio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function secretOk(request) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  // Refuse rather than wave it through. An unset secret on a public endpoint
  // is not "no security configured", it is an open door, and the failure is
  // silent until somebody walks through it.
  if (!expected) return false;

  const given = request.headers.get("x-telegram-bot-api-secret-token") || "";
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(request) {
  if (!configured()) return new Response("not configured", { status: 503 });
  if (!secretOk(request)) return new Response("no", { status: 401 });

  let update;
  try {
    update = await request.json();
  } catch {
    return Response.json({ ok: true });
  }

  const message = update?.message || update?.edited_message;
  const chat = message?.chat;
  const text = String(message?.text || "").trim();

  // Telegram retries anything that is not answered with a 200, so every path
  // out of here returns ok - including the ones where we did nothing. A
  // message we do not understand is not an error, it is somebody saying hello
  // to a bot.
  if (!chat?.id || !text.startsWith("/start")) {
    return Response.json({ ok: true });
  }

  const token = text.slice("/start".length).trim();
  const email = token ? readLinkToken(token) : null;

  if (!email) {
    try {
      await sendMessage(
        chat.id,
        "This link has expired. Open your watchlist on Market Tide and tap " +
          "<b>Connect Telegram</b> again."
      );
    } catch {
      // The reader will try again; a failed courtesy reply is not worth a 500
      // and a Telegram retry.
    }
    return Response.json({ ok: true });
  }

  try {
    await setTelegram(email, {
      chatId: chat.id,
      username: chat.username || null,
      firstName: chat.first_name || null,
      linkedAt: new Date(),
    });

    const held = await listPortfolio(email);
    await sendMessage(
      chat.id,
      held.length
        ? `Connected. You will get an alert here as soon as anything is filed ` +
          `by the ${held.length} ${held.length === 1 ? "company" : "companies"} ` +
          `on your watchlist, with the summary and a link to the PDF.`
        : `Connected. Add stocks to your watchlist on Market Tide and I will ` +
          `send their filings here as they come in.`
    );
  } catch (error) {
    console.error("[telegram] link failed:", error);
  }

  return Response.json({ ok: true });
}
