import assert from "node:assert/strict";

process.env.KIT_API_KEY = "test-kit-key";
process.env.KIT_FROM_EMAIL = "brief@markettide.in";

const requests = [];
global.fetch = async (url, init = {}) => {
  requests.push({ url, init });
  const method = init.method || "GET";
  if (url.includes("/broadcasts?")) return Response.json({ broadcasts: [] });
  if (url.endsWith("/subscribers") && method === "POST" && !url.includes("/tags/")) {
    return Response.json({ subscriber: { id: 42 } });
  }
  if (url.endsWith("/tags") && method === "POST") {
    return Response.json({ tag: { id: 77 } }, { status: 201 });
  }
  if (url.includes("/tags/77/subscribers") && method === "POST") {
    return Response.json({ subscriber: { id: 42 } });
  }
  if (url.endsWith("/broadcasts") && method === "POST") {
    return Response.json({ broadcast: { id: 99 } }, { status: 201 });
  }
  throw new Error(`Unexpected Kit request: ${method} ${url}`);
};

const { sendKitTrialReminder } = await import("../lib/kit-trial-reminders.js");
const delivery = await sendKitTrialReminder({
  to: "reader@example.com",
  subject: "Trial update",
  html: "<p>Hello reader</p>",
  idempotencyKey: "market-tide/trial-expired/abc123",
});

assert.equal(delivery.sent, true);
assert.equal(delivery.id, 99);
assert.equal(requests.length, 5);
const broadcastRequest = requests.at(-1);
const broadcastBody = JSON.parse(broadcastRequest.init.body);
assert.equal(broadcastBody.email_address, "brief@markettide.in");
assert.deepEqual(broadcastBody.subscriber_filter, [{ all: [{ type: "tag", ids: [77] }] }]);
assert.equal(broadcastBody.description, "Market Tide market-tide/trial-expired/abc123");

requests.length = 0;
global.fetch = async (url, init = {}) => {
  requests.push({ url, init });
  return Response.json({
    broadcasts: [{ id: 99, description: "Market Tide market-tide/trial-expired/abc123" }],
  });
};
const retry = await sendKitTrialReminder({
  to: "reader@example.com",
  subject: "Trial update",
  html: "<p>Hello reader</p>",
  idempotencyKey: "market-tide/trial-expired/abc123",
});
assert.deepEqual(retry, { sent: true, id: 99, reused: true });
assert.equal(requests.length, 1);

console.log("Kit trial reminder delivery: all checks pass");
