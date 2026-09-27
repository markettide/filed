/** Legacy waitlist API retained as a MongoDB-backed compatibility wrapper. */

import {
  countNewsletterSubscribers,
  listNewsletterSubscribers,
  subscribeUser,
} from "./users.js";

/** Returns { ok, backend, alreadyJoined }. */
export async function addEmail(email, meta = {}) {
  const result = await subscribeUser({
    email,
    phone: meta.phone || null,
    source: meta.source || meta.via || "legacy-waitlist",
  });
  return {
    ok: true,
    backend: "mongodb",
    alreadyJoined: result.alreadySubscribed,
  };
}

export async function listEmails() {
  return listNewsletterSubscribers();
}

export async function count() {
  return countNewsletterSubscribers();
}
