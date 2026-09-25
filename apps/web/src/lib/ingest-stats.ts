import { logger } from "./logger";

/**
 * In-process ingest counters, logged as one `ingest.stats` line every 5 minutes
 * (only when something happened) and exposed on /api/admin/ops. Cheap
 * observability without a metrics stack; per-record logs would be too noisy.
 */
export const INGEST_OUTCOMES = [
  "stored",
  "stored_late",
  "duplicate",
  "no_fix",
  "unknown_device",
  "device_inactive",
  "rejected_auth",
  "rejected_payload",
  "store_failed",
  "publish_failed"
] as const;
export type IngestCounter = (typeof INGEST_OUTCOMES)[number];

const FLUSH_MS = 5 * 60_000;
const g = globalThis as unknown as {
  __rioIngest?: { window: Record<string, number>; total: Record<string, number>; since: string; lastStoredAt: string | null; timer?: NodeJS.Timeout };
};

function state() {
  if (!g.__rioIngest) {
    g.__rioIngest = { window: {}, total: {}, since: new Date().toISOString(), lastStoredAt: null };
    const t = setInterval(() => {
      const s = g.__rioIngest!;
      if (Object.keys(s.window).length === 0) return;
      logger.info("ingest.stats", { windowSeconds: FLUSH_MS / 1000, ...s.window });
      s.window = {};
    }, FLUSH_MS);
    t.unref?.();
    g.__rioIngest.timer = t;
  }
  return g.__rioIngest;
}

export function countIngest(outcome: IngestCounter) {
  const s = state();
  s.window[outcome] = (s.window[outcome] ?? 0) + 1;
  s.total[outcome] = (s.total[outcome] ?? 0) + 1;
  if (outcome === "stored" || outcome === "stored_late") s.lastStoredAt = new Date().toISOString();
}

export function ingestSnapshot() {
  const s = state();
  return { since: s.since, lastStoredAt: s.lastStoredAt, totals: { ...s.total } };
}
