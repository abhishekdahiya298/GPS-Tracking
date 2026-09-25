/**
 * Pure, framework-free helpers for the live map (unit-tested). Nothing here
 * changes GPS data: interpolation only produces display coordinates.
 */
import type { CurrentDeviceLocation, LocationPoint } from "@/lib/locations";

export type MapState = "moving" | "idle" | "offline";
export const MAP_STATES: MapState[] = ["moving", "idle", "offline"];
export const MOVING_KPH = 5;

export function deviceLabel(d: Pick<CurrentDeviceLocation, "vehicle" | "name" | "model">) {
  return d.vehicle?.name ?? d.name ?? d.model ?? "Device";
}

/** Presentation state. Offline is decided from last_seen so it stays right between snapshots. */
export function mapState(d: Pick<CurrentDeviceLocation, "lastSeenAt" | "location">, nowMs: number, offlineSeconds: number): MapState {
  if (!d.lastSeenAt || nowMs - Date.parse(d.lastSeenAt) > offlineSeconds * 1000) return "offline";
  return (d.location?.speedKph ?? 0) >= MOVING_KPH ? "moving" : "idle";
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

/** Quick history ranges in the browser's local time. */
export function quickRange(kind: "today" | "yesterday" | "7d", now = new Date()): { from: Date; to: Date | null } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (kind === "today") return { from: start, to: null };
  if (kind === "yesterday") return { from: new Date(start.getTime() - 86_400_000), to: start };
  return { from: new Date(start.getTime() - 6 * 86_400_000), to: null };
}

/** North America fallback when there's nothing to fit. */
export const FALLBACK_VIEW = { center: [-98.6, 39.8] as [number, number], zoom: 3.2 };
