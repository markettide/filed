/**
 * Connect or disconnect Telegram.
 *
 *   GET    /api/telegram/link  -> { url } , the deep link to tap
 *   DELETE /api/telegram/link  -> forget the chat
 *
 * Alerts are the Premium half of the watchlist. A free reader can hold five
 * stocks and see them on the dashboard; being told the moment something is
 * filed is what they are paying for. So the link endpoint asks for Premium
 * while /api/portfolio does not.
 */

import { requirePremiumAccess } from "../../../../lib/entitlements";
import { configured, deepLink, botName } from "../../../../lib/telegram";
import { setTelegram, configured as dbReady } from "../../../../lib/portfolio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "private, no-store" };

export async function GET(request) {
  const context = await requirePremiumAccess(request);
  if (context instanceof Response) return context;

  if (!configured() || !botName()) {
    return Response.json(
      {
        error:
          "Telegram alerts are not switched on yet. TELEGRAM_BOT_TOKEN and " +
          "TELEGRAM_BOT_NAME need to be set.",
      },
      { status: 503, headers: PRIVATE }
    );
  }

  const url = deepLink(context.email);
  if (!url) {
    return Response.json(
      { error: "Could not build a link. AUTH_SECRET is missing." },
      { status: 503, headers: PRIVATE }
    );
  }

  return Response.json({ url }, { headers: PRIVATE });
}

export async function DELETE(request) {
  const context = await requirePremiumAccess(request);
  if (context instanceof Response) return context;
  if (!dbReady()) {
    return Response.json(
      { error: "Watchlists are not configured on this deployment." },
      { status: 503, headers: PRIVATE }
    );
  }

  try {
    await setTelegram(context.email, null);
    return Response.json({ ok: true }, { headers: PRIVATE });
  } catch (error) {
    console.error("[telegram] unlink failed:", error);
    return Response.json(
      { error: "Could not disconnect Telegram." },
      { status: 500, headers: PRIVATE }
    );
  }
}
