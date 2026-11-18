/**
 * Pure, framework-free helpers for the live map (unit-tested). Nothing here
 * changes GPS data: interpolation only produces display coordinates.
 */
import { isFixStale } from "@rio-gps/core/freshness";
import { addDays, dateFormatter, startOfLocalDay } from "@rio-gps/core/timezones";
import type { CurrentDeviceLocation, LocationPoint } from "@/lib/locations";

/**
 * moving: travelling. idle: engine on but standing still (burning fuel).
 * stopped: standing still with the engine off, or the tracker has no ignition wire.
 * offline: the tracker has not reported for longer than the offline threshold.
 */
export type MapState = "moving" | "idle" | "stopped" | "parked" | "offline";
/** The four filter chips; "parked" trailers are shown under Stopped. */
export const MAP_STATES: MapState[] = ["moving", "idle", "stopped", "offline"];
/** Sort order for the list (parked trailers after stopped vehicles). */
export const STATE_ORDER: MapState[] = ["moving", "idle", "stopped", "parked", "offline"];
/** The filter chip a state belongs to. */
export function stateBucket(s: MapState): Exclude<MapState, "parked"> {
  return s === "parked" ? "stopped" : s;
}
export const MOVING_KPH = 5;

export function deviceLabel(d: Pick<CurrentDeviceLocation, "vehicle" | "name" | "model">) {
  return d.vehicle?.name ?? d.name ?? d.model ?? "Device";
}

/** Presentation state. Offline is decided from last_seen so it stays right between snapshots. */
export function mapState(d: Pick<CurrentDeviceLocation, "lastSeenAt" | "location"> & { vehicle?: { type: string } | null }, nowMs: number, offlineSeconds: number): MapState {
  if (!d.lastSeenAt || nowMs - Date.parse(d.lastSeenAt) > offlineSeconds * 1000) {
    // A trailer's tracker is powered by the tractor: silence after reporting means unhooked.
    return d.lastSeenAt && d.vehicle?.type === "trailer" ? "parked" : "offline";
  }
  // Online, but the newest position is old (backlog upload, or no GNSS fix): its speed and
  // ignition are history, so the vehicle is never shown as Moving or Idling from it.
  if (hasStaleFix(d, nowMs, offlineSeconds)) return "stopped";
  if ((d.location?.speedKph ?? 0) >= MOVING_KPH) return "moving";
  return d.location?.ignition === true ? "idle" : "stopped";
}

/**
 * True when the tracker is reporting (online) but its newest GPS position is older than the
 * offline threshold: the map shows "No current GPS" with the fix's age instead of a status.
 */
export function hasStaleFix(d: Pick<CurrentDeviceLocation, "lastSeenAt" | "location">, nowMs: number, offlineSeconds: number): boolean {
  if (!d.location || !d.lastSeenAt || nowMs - Date.parse(d.lastSeenAt) > offlineSeconds * 1000) return false;
  return isFixStale(d.location.recordedAt, nowMs, offlineSeconds);
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
/** Eight-point compass direction for a heading in degrees (0 = north). */
export function compass(deg: number | null | undefined): string | null {
  if (deg === null || deg === undefined || !Number.isFinite(deg)) return null;
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
}

const rad = (d: number) => (d * Math.PI) / 180;

/** Initial bearing a→b in degrees (0 = north). */
export function bearing(a: [number, number], b: [number, number]): number {
  const [lon1, lat1] = [rad(a[0]), rad(a[1])];
  const [lon2, lat2] = [rad(b[0]), rad(b[1])];
  const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

export function haversineKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Display position between two fixes at progress t (0..1), eased. */
export function lerpLngLat(from: [number, number], to: [number, number], t: number): [number, number] {
  const k = ease(Math.max(0, Math.min(1, t)));
  return [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k];
}

/** Only animate plausible short moves; teleport otherwise (e.g. after a long gap). */
export function shouldAnimate(from: [number, number], to: [number, number]) {
  const km = haversineKm({ longitude: from[0], latitude: from[1] }, { longitude: to[0], latitude: to[1] });
  return km > 0.002 && km < 5;
}

/** Index of the last point recorded at or before t (points sorted by time). */
export function indexAtTime(times: number[], t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  if (hi < 0 || t <= times[0]!) return 0;
  if (t >= times[hi]!) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid]! <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export interface TrackStats {
  km: number;
  maxKph: number;
  /** cumulative km at each index (for "distance so far") */
  cumKm: Float64Array;
}

/** Distance and max speed of a track; drops implausible jumps (> 250 km/h) like the trip reports. */
export function trackStats(pts: LocationPoint[]): TrackStats {
  const cum = new Float64Array(pts.length);
  let km = 0;
  let max = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const d = haversineKm(a, b);
    const h = (Date.parse(b.recordedAt) - Date.parse(a.recordedAt)) / 3_600_000;
    if (h > 0 && d / h <= 250) km += d;
    cum[i] = km;
    max = Math.max(max, b.speedKph ?? 0);
  }
  if (pts[0]) max = Math.max(max, pts[0].speedKph ?? 0);
  return { km, maxKph: max, cumKm: cum };
}

/** Quick history ranges as local calendar days in `timeZone` (DST-safe). */
export function quickRange(kind: "today" | "yesterday" | "7d", timeZone: string, now = new Date()): { from: Date; to: Date | null } {
  const today = dateFormatter(timeZone).dayKey(now);
  const start = startOfLocalDay(today, timeZone);
  if (kind === "today") return { from: start, to: null };
  if (kind === "yesterday") return { from: startOfLocalDay(addDays(today, -1), timeZone), to: start };
  return { from: startOfLocalDay(addDays(today, -6), timeZone), to: null };
}

/** One CSV cell: quoted when needed, and never starting a spreadsheet formula. */
export function csvSafe(v: string | number | null | undefined): string {
  let s = v === null || v === undefined ? "" : String(v);
  // Plain numbers (a negative longitude) are data, not formulas.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** North America fallback when there's nothing to fit. */
export const FALLBACK_VIEW = { center: [-98.6, 39.8] as [number, number], zoom: 3.2 };

/**
 * The 3D pin for a vehicle, the same artwork as the phone app (public/map/pin-*.png):
 * a trailer pin for trailers, a truck pin for everything else, and for a moving vehicle one of
 * eight heading arrows (0 = north, 2 = east …), so the map and the app always look alike.
 */
/** How vehicles are drawn: 3D pin, round or square badge, or top-down (turns with the heading). */
export type IconStyle = "photo" | "pin" | "circle" | "square" | "top";
export type IconColor = "status" | "type";
export interface IconPrefs { style: IconStyle; color: IconColor }
export const DEFAULT_ICON_PREFS: IconPrefs = { style: "photo", color: "status" };

/** Backend vehicle type → the picture on the icon (same rule as the phone app). */
export function iconKind(type: string | null | undefined): string {
  switch (type) {
    case "truck":
    case "semi":
    case "box_truck":
    case "tanker":
    case "dump_truck":
    case "mixer":
    case "garbage_truck":
      return "truck";
    case "trailer":
    case "van":
    case "pickup":
    case "car":
    case "bus":
    case "equipment":
      return type;
    case "school_bus":
      return "bus";
    case "excavator":
    case "tractor":
      return "equipment";
    case "motorcycle":
      return "car";
    default:
      return "asset";
  }
}

/** Map icon name, e.g. "pin-status-truck-idle" or "top-trailer-moving" (files in /fleet-art/map/icons). */
export function iconName(type: string | null | undefined, state: MapState, prefs: IconPrefs = DEFAULT_ICON_PREFS): string {
  if (prefs.style === "top") {
    // "Tractor only" is the cab alone, as in the phone app.
    if (type === "semi") return `top-tractor-${state}`;
    const k = iconKind(type);
    return `top-${k === "truck" || k === "bus" || k === "equipment" ? "truck" : k === "trailer" ? "trailer" : "car"}-${state}`;
  }
  if (prefs.style === "photo") return `photo-${photoKind(type)}-${state}`;
  return `${prefs.style}-${prefs.color}-${iconKind(type)}-${state}`;
}

/** Types with their own photo pin (the vehicle's 3D picture in a ring of its status colour). */
const PHOTO_KINDS = ["truck", "semi", "trailer", "car", "van", "pickup", "box_truck", "tanker", "dump_truck", "mixer", "garbage_truck", "bus", "school_bus"];
export function photoKind(type: string | null | undefined): string {
  if (type && PHOTO_KINDS.includes(type)) return type;
  return type === "motorcycle" ? "car" : "truck";
}

const KINDS = ["truck", "trailer", "van", "pickup", "car", "bus", "equipment", "asset"];
const STATES: MapState[] = ["moving", "idle", "stopped", "parked", "offline"];
/** Every icon one style draws, for loading onto the map. */
export function iconNames(prefs: IconPrefs): string[] {
  if (prefs.style === "top") return ["truck", "trailer", "car", "tractor"].flatMap((k) => STATES.map((s) => `top-${k}-${s}`));
  if (prefs.style === "photo") return PHOTO_KINDS.flatMap((k) => STATES.map((s) => `photo-${k}-${s}`));
  return KINDS.flatMap((k) => STATES.map((s) => `${prefs.style}-${prefs.color}-${k}-${s}`));
}
