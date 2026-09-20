import { isAdmin } from "../../../../lib/admin-auth";
import { adminData } from "../../../../lib/admin-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function privateJson(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private, max-age=0" },
  });
}

export async function GET(request) {
  if (!isAdmin(request)) return privateJson({ error: "Unauthorized." }, 401);

  try {
    return privateJson(await adminData(
      request.nextUrl.searchParams.get("date"),
      request.nextUrl.searchParams.get("days") || 30,
      {
        memberPage: request.nextUrl.searchParams.get("memberPage"),
        memberQuery: request.nextUrl.searchParams.get("memberQuery"),
        paidPage: request.nextUrl.searchParams.get("paidPage"),
        paidQuery: request.nextUrl.searchParams.get("paidQuery"),
        trialPage: request.nextUrl.searchParams.get("trialPage"),
        trialQuery: request.nextUrl.searchParams.get("trialQuery"),
        trialStatus: request.nextUrl.searchParams.get("trialStatus"),
        visitorPage: request.nextUrl.searchParams.get("visitorPage"),
        livePage: request.nextUrl.searchParams.get("livePage"),
      }
    ));
  } catch (error) {
    console.error("[admin] dashboard load failed:", error.message || error);
    return privateJson({ error: "Could not load admin data." }, 503);
  }
}
