/**
 * Who is signed in, and whether signing in works at all.
 *
 *   GET  /api/auth/me      -> { user, channels }
 *   POST /api/auth/logout  -> clears the cookie (see ../logout)
 *
 * `channels` lets the sign-in page offer only what this deployment can
 * actually deliver, instead of presenting a WhatsApp button that fails after
 * the reader has typed their number.
 */

import { currentUser } from "../../../../lib/session";
import { authReady } from "../../../../lib/auth-ready";
import { emailConfigured } from "../../../../lib/notify";
import { findByEmail } from "../../../../lib/users";
import { accessForProfile } from "../../../../lib/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const user = currentUser(request);
  const emailReady = emailConfigured();
  let profile = null;
  if (user?.channel === "email") {
    try {
      profile = await findByEmail(user.id.slice(user.id.indexOf(":") + 1));
    } catch {
      // A profile lookup should not turn a valid session into a signed-out UI.
    }
  }

  return Response.json({
    user: user ? {
      id: user.id.slice(user.id.indexOf(":") + 1),
      channel: user.channel,
      name: profile?.name || null,
      phone: profile?.phone || null,
      newsletterSubscribed: Boolean(profile?.briefSubscribed),
      plan: accessForProfile(profile).level,
      access: accessForProfile(profile),
    } : null,
    channels: {
      email: emailReady,
      whatsapp: false,
    },
    ready: authReady(),
  });
}
