/** Throttle for live `seen` pings (see publishDeviceSeen). Pure and in-process. */

/** One `seen` ping per device per this many ms is plenty: maps show "last seen" to the minute. */
export const SEEN_PUBLISH_MIN_INTERVAL_MS = 30_000;
const lastSeenPublished = new Map<string, number>();

/** True when a `seen` ping for this device is due (and records it). Bounded, so it can't grow without limit. */
export function shouldPublishSeen(deviceId: string, nowMs: number, minIntervalMs = SEEN_PUBLISH_MIN_INTERVAL_MS): boolean {
  const last = lastSeenPublished.get(deviceId);
  if (last !== undefined && nowMs - last < minIntervalMs) return false;
  if (lastSeenPublished.size >= 10_000) lastSeenPublished.clear();
  lastSeenPublished.set(deviceId, nowMs);
  return true;
}

/** Test helper. */
export function resetSeenThrottle(): void {
  lastSeenPublished.clear();
}
