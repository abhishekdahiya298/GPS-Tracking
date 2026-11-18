/**
 * Is a vehicle's current position actually current?
 *
 * A tracker can be online (it reported a moment ago) while its newest GPS position is old:
 * - it is uploading records it stored while it had no mobile signal (oldest first), or
 * - it has no GNSS fix (antenna covered, inside a building) and only sends heartbeats.
 * In both cases the speed, heading and ignition on that position describe the past, so the
 * apps must not show the vehicle as "Moving 49 mph" now. Pure: shared by web and mobile.
 */

/**
 * Default oldest fix age that still counts as current. Same as the default offline threshold
 * (GPS_DEVICE_OFFLINE_THRESHOLD_SECONDS): a parked truck on the low-data profile sends one
 * record an hour, so its latest fix can be just under an hour old and still be current.
 */
export const DEFAULT_MAX_FIX_AGE_SECONDS = 3_900;

/** Age of a GPS fix in seconds (never negative: a tracker clock slightly ahead counts as 0). */
export function fixAgeSeconds(recordedAt: string | Date, nowMs: number): number {
  const t = typeof recordedAt === "string" ? Date.parse(recordedAt) : recordedAt.getTime();
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (nowMs - t) / 1000);
}

/** True when the position is too old to describe what the vehicle is doing now. */
export function isFixStale(recordedAt: string | Date, nowMs: number, maxAgeSeconds: number = DEFAULT_MAX_FIX_AGE_SECONDS): boolean {
  return fixAgeSeconds(recordedAt, nowMs) > maxAgeSeconds;
}
