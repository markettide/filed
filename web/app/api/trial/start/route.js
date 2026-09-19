import { accessForProfile, emailFromSession, TRIAL_DAYS } from "../../../../lib/entitlements";
import { findByEmail, startPremiumTrial } from "../../../../lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const email = emailFromSession(request);
  if (!email) {
    return Response.json({ error: "Please sign in before starting your trial." }, { status: 401 });
  }

  try {
    const before = await findByEmail(email);
    const currentAccess = accessForProfile(before);
    if (currentAccess.paidActive) {
      return Response.json({ error: "Your Premium plan is already active.", access: currentAccess }, { status: 409 });
    }
    if (!currentAccess.trialAvailable) {
      return Response.json(
        {
          error: currentAccess.trialActive
            ? "Your free trial is already active."
            : "This account has already used its free trial.",
          access: currentAccess,
        },
        { status: 409 }
      );
    }

    const { started, profile } = await startPremiumTrial(email, TRIAL_DAYS);
    const access = accessForProfile(profile);
    if (!started || !access.trialActive) {
      return Response.json({ error: "This account has already used its free trial.", access }, { status: 409 });
    }
    return Response.json(
      { ok: true, access },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("[trial] start failed:", error);
    return Response.json({ error: "Could not start your trial. Please try again." }, { status: 500 });
  }
}
