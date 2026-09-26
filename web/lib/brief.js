/**
 * The morning brief, read back out of the same KV store the dashboard uses.
 *
 * newsletter.py writes each day's PDF as base64 in numbered chunks, exactly
 * the shape publish.py already uses for a heavy day's filings, so there is no
 * second storage service to keep alive. Here we put it back together.
 */

import { withServerCache } from "./server-cache";
import { readMarketMirror } from "./market-mirror";

const URL_ = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;

async function redis(command) {
  const mirrored = await readMarketMirror(command);
  if (mirrored.hit) return mirrored.result;
  if (!URL_ || !TOKEN) return null;
  const r = await fetch(URL_, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!r.ok) return null;
  return (await r.json()).result;
}

/** Every day we hold a brief for, newest first. */
async function loadBriefDays() {
  const raw = await redis(["GET", "mt:brief:index"]);
  if (!raw) return [];
  try {
    const days = JSON.parse(raw);
    return Array.isArray(days) ? days : [];
  } catch {
    return [];
  }
}


export async function briefDays() {
  return withServerCache("brief:days", 60_000, loadBriefDays);
}

/** One day's PDF as a Buffer, or null if we don't have that day. */
async function loadBriefPdf(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "")) return null;

  const parts = Number(await redis(["GET", `mt:brief:${day}:parts`]) || 0);
  if (!parts) return null;

  const chunks = (await redis([
    "MGET",
    ...Array.from({ length: parts }, (_, i) => `mt:brief:${day}:${i}`),
  ])) || [];
  if (chunks.length !== parts) return null;
  if (chunks.some((c) => c == null)) return null;      // a part expired

  return Buffer.from(chunks.join(""), "base64");
}

export async function briefPdf(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "")) return null;
  return withServerCache(
    `brief:pdf:${day}`,
    60_000,
    () => loadBriefPdf(day),
    { cacheNull: false }
  );
}
