/** Kit is the delivery service for Daily Brief subscriptions. */

const API = "https://api.kit.com/v4";

export function configured() {
  return Boolean(process.env.KIT_API_KEY);
}

export async function upsertSubscriber(email, firstName = null) {
  if (!configured()) return { ok: false, skipped: true, reason: "Kit not configured" };
  const response = await fetch(`${API}/subscribers`, {
    method: "POST",
    headers: {
      "X-Kit-Api-Key": process.env.KIT_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email_address: email,
      first_name: firstName || undefined,
      state: "active",
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error(`Kit ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  return { ok: true, data: await response.json() };
}
