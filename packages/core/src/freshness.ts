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

/**
 * Silence after which a tracker counts as not reporting. RIO's standard tracker configs
 * (RIO-GPS-FTM880-v2, RIO-GPS-FTM164-trailer-v2) report every 4 h while parked and asleep,
 * so a parked vehicle is only flagged after 4 h 30 min. Server env can raise it.
 */
export const DEFAULT_OFFLINE_SECONDS = 16_200;
/**
 * A vehicle whose last report says it was driving normally reports every 30-60 s. Silence
 * past this means it is in a dead zone (the tracker keeps the data and uploads it later).
 */
export const NO_SIGNAL_SECONDS = 900;
/** Speed at or above which a fix counts as driving (same as the apps' Moving state). */
export const DRIVING_KPH = 5;

type FixLike = { speedKph: number | null } | null | undefined;

/** True when the last fix says the vehicle was driving. */
export function fixWasDriving(loc: FixLike): boolean {
  return (loc?.speedKph ?? 0) >= DRIVING_KPH;
}

/**
 * Oldest fix that still describes the vehicle now. A driving fix goes stale after about an hour
 * (it would wrongly claim Moving); a parked fix stays true until the vehicle is due to report.
 */
export function maxFixAgeFor(loc: FixLike, offlineSeconds: number = DEFAULT_OFFLINE_SECONDS): number {
  return fixWasDriving(loc) ? DEFAULT_MAX_FIX_AGE_SECONDS : Math.max(DEFAULT_MAX_FIX_AGE_SECONDS, offlineSeconds);
}

/**
 * Is the tracker silent for longer than its state allows?
 * - driving at the last report: silent past NO_SIGNAL_SECONDS (dead zone), or
 * - anything else: silent past offlineSeconds (parked trackers report every 4 h).
 * Never-seen trackers are not "silent" (they have no data yet).
 */
export function isSilent(lastSeenAt: string | Date | null | undefined, loc: FixLike, nowMs: number, offlineSeconds: number = DEFAULT_OFFLINE_SECONDS): boolean {
  if (!lastSeenAt) return false;
  const age = fixAgeSeconds(lastSeenAt, nowMs);
  return age > offlineSeconds || (fixWasDriving(loc) && age > NO_SIGNAL_SECONDS);
}

/**
 * External (vehicle) voltage in volts from a Traccar position's attributes. Traccar names it
 * "power" for most Teltonika models; FT-platform trackers (FTM880, FTM164) send it as AVL 800
 * in millivolts ("io800"); older models as AVL 66 ("io66", mV).
 */
export function externalPowerVolts(attributes: Record<string, unknown> | null | undefined): number | null {
  if (!attributes) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  const power = num(attributes.power);
  if (power !== null) return power > 100 ? power / 1000 : power;
  for (const k of ["io800", "io66"]) {
    const mv = num(attributes[k]);
    if (mv !== null) return mv / 1000;
  }
  return null;
}

/** Vehicle power counts as cut below this (a 12/24 V truck reads 11.5 V+ even with the engine off). */
export const POWER_CUT_VOLTS = 6;
