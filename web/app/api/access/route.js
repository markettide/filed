import { accessForRequest } from "../../../lib/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { email, access } = await accessForRequest(request);
    return Response.json(
      { signedIn: Boolean(email), access },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("[access] lookup failed:", error);
    return Response.json({ error: "Could not check your access." }, { status: 500 });
  }
}
