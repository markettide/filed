import {
  adminConfigured,
  adminCookie,
  adminRateLimitKey,
  clearAdminCookie,
  correctAdminPassword,
  createAdminSession,
  isAdmin,
} from "../../../../lib/admin-auth";
import { clearRateLimit, rateLimit } from "../../../../lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function privateJson(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private, max-age=0", ...headers },
  });
}

async function limit(request, clear = false) {
  const key = adminRateLimitKey(request);
  try {
    if (clear) {
      await clearRateLimit("admin-login", key);
      return { allowed: true };
    }
    const result = await rateLimit({
      scope: "admin-login",
      identifier: key,
      maximum: 8,
      windowSeconds: 900,
    });
    return { allowed: result.allowed, retryMinutes: 15 };
  } catch {
    return { allowed: true };
  }
}

export async function GET(request) {
  return privateJson({ configured: adminConfigured(), authenticated: isAdmin(request) });
}

export async function POST(request) {
  if (!adminConfigured()) return privateJson({ error: "Admin access is not configured." }, 503);
  const rate = await limit(request);
  if (!rate.allowed) {
    return privateJson({ error: "Too many attempts. Try again in 15 minutes." }, 429);
  }
  let password = "";
  try {
    password = String((await request.json()).password || "");
  } catch {
    return privateJson({ error: "Enter the admin password." }, 400);
  }
  if (!correctAdminPassword(password)) {
    return privateJson({ error: "Incorrect password." }, 401);
  }
  await limit(request, true);
  return privateJson(
    { ok: true },
    200,
    { "Set-Cookie": adminCookie(createAdminSession()) }
  );
}

export async function DELETE() {
  return privateJson({ ok: true }, 200, { "Set-Cookie": clearAdminCookie() });
}
