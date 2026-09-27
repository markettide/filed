/**
 * Finish a one-click Telegram Login Widget connection.
 *
 * The widget asks Telegram for permission for this bot to message the reader.
 * Telegram then signs the reader record with the bot token.  We verify that
 * signature before attaching the Telegram id to the already signed-in Market
 * Tide account.
 */

import { requirePremiumAccess } from "../../../../lib/entitlements";
import {
  configured,
  sendMessage,
  verifyLoginPayload,
} from "../../../../lib/telegram";
import { setTelegram, configured as dbReady } from "../../../../lib/watchlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "private, no-store" };

export async function POST(request) {
  const context = await requirePremiumAccess(request);
  if (context instanceof Response) return context;
  if (!configured() || !dbReady()) {
    return Response.json(
      { error: "Telegram alerts are not configured on this deployment." },
      { status: 503, headers: PRIVATE }
    );
  }

  const body = await request.json().catch(() => null);
  const telegram = verifyLoginPayload(body);
  if (!telegram) {
    return Response.json(
      { error: "Telegram could not verify this connection. Please try again." },
      { status: 401, headers: PRIVATE }
    );
  }

  try {
    // This call also confirms that the reader granted the widget's requested
    // write permission. Do not show Connected if Telegram cannot reach them.
    await sendMessage(
      telegram.chatId,
      "<b>Market Tide alerts are connected.</b>\n\nNew filings from your watchlist will arrive here."
    );
    await setTelegram(context.email, {
      ...telegram,
      source: "login_widget",
      linkedAt: new Date(),
    });
    return Response.json(
      { ok: true, username: telegram.username },
      { headers: PRIVATE }
    );
  } catch (error) {
    console.error("[telegram] widget link failed:", error);
    return Response.json(
      {
        error:
          "Telegram did not grant messaging permission. Please approve messages and try again.",
      },
      { status: 400, headers: PRIVATE }
    );
  }
}
