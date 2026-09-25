import { haversineMeters } from "./geo.js";

/**
 * Trip detection over a time-ordered track.
 *
 * A point is "active" when the ignition is on, or (if ignition is unknown)
 * the vehicle moves at >= MOVING_KPH. A trip is a run of active points; it
 * ends after STOP_MINUTES of inactivity or a data gap longer than GAP_MINUTES.
 * Very short runs (< MIN_TRIP_METERS and < MIN_TRIP_MINUTES) are GPS noise.
 */
export const TRIP_DEFAULTS = {
  MOVING_KPH: 5,
  STOP_MINUTES: 5,
  GAP_MINUTES: 20,
  MIN_TRIP_METERS: 200,
  MIN_TRIP_MINUTES: 2,
  /** Segments implying a speed above this are GPS jumps and don't count as distance. */
  MAX_PLAUSIBLE_KPH: 250,
  IDLE_KPH: 3
} as const;

export interface TrackPoint {
  t: number; // epoch ms
  lat: number;
  lon: number;
  speedKph: number | null;
  ignition: boolean | null;
}

export interface Trip {
  start: TrackPoint;
  end: TrackPoint;
  distanceM: number;
  durationS: number;
  movingS: number;
  idleS: number;
  maxSpeedKph: number;
  avgMovingKph: number;
  points: number;
}

function active(p: TrackPoint, movingKph: number) {
  if (p.ignition !== null) return p.ignition;
  return (p.speedKph ?? 0) >= movingKph;
}

export function detectTrips(points: TrackPoint[], opts: Partial<typeof TRIP_DEFAULTS> = {}): Trip[] {
  const o = { ...TRIP_DEFAULTS, ...opts };
  const trips: Trip[] = [];
  let cur: TrackPoint[] = [];
  let lastActiveT = -Infinity;

  const close = () => {
    // Drop trailing inactive points so the trip ends at the last active one.
    while (cur.length && !active(cur[cur.length - 1]!, o.MOVING_KPH)) cur.pop();
    if (cur.length >= 2) {
      const t = summarize(cur, o);
      if (t.distanceM >= o.MIN_TRIP_METERS || t.durationS >= o.MIN_TRIP_MINUTES * 60) trips.push(t);
    }
    cur = [];
  };

  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const prev = points[i - 1];
    if (cur.length && prev && p.t - prev.t > o.GAP_MINUTES * 60_000) close();
    if (active(p, o.MOVING_KPH)) {
      // Consecutive active points never split (sparse reporting while driving);
      // only an inactive stretch of STOP_MINUTES or a data gap does.
      const prevInactive = prev !== undefined && !active(prev, o.MOVING_KPH);
      if (cur.length && prevInactive && p.t - lastActiveT > o.STOP_MINUTES * 60_000) close();
      cur.push(p);
      lastActiveT = p.t;
    } else if (cur.length) {
      if (p.t - lastActiveT > o.STOP_MINUTES * 60_000) close();
      else cur.push(p);
    }
  }
  close();
  return trips;
}

function summarize(pts: TrackPoint[], o: typeof TRIP_DEFAULTS): Trip {
  let distanceM = 0;
  let movingS = 0;
  let idleS = 0;
  let maxSpeedKph = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    maxSpeedKph = Math.max(maxSpeedKph, p.speedKph ?? 0);
    if (i === 0) continue;
    const a = pts[i - 1]!;
    const dt = (p.t - a.t) / 1000;
    if (dt <= 0) continue;
    const d = haversineMeters([a.lon, a.lat], [p.lon, p.lat]);
    if ((d / dt) * 3.6 <= o.MAX_PLAUSIBLE_KPH) distanceM += d;
    if ((a.speedKph ?? 0) < o.IDLE_KPH && a.ignition === true) idleS += dt;
    else movingS += dt;
  }
  const start = pts[0]!;
  const end = pts[pts.length - 1]!;
  const durationS = (end.t - start.t) / 1000;
  return {
    start,
    end,
    distanceM: Math.round(distanceM),
    durationS: Math.round(durationS),
    movingS: Math.round(movingS),
    idleS: Math.round(idleS),
    maxSpeedKph: Math.round(maxSpeedKph),
    avgMovingKph: movingS > 0 ? Math.round((distanceM / movingS) * 3.6 * 10) / 10 : 0,
    points: pts.length
  };
}

/** Local calendar day (YYYY-MM-DD) of an instant in an IANA time zone. */
export function localDay(t: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
}

export interface DaySummary {
  day: string;
  trips: number;
  distanceM: number;
  drivingS: number;
  maxSpeedKph: number;
}

/** Daily totals, attributing each trip to the local day it started. */
export function summarizeByDay(trips: Trip[], timeZone: string): DaySummary[] {
  const map = new Map<string, DaySummary>();
  for (const t of trips) {
    const day = localDay(t.start.t, timeZone);
    const d = map.get(day) ?? { day, trips: 0, distanceM: 0, drivingS: 0, maxSpeedKph: 0 };
    d.trips++;
    d.distanceM += t.distanceM;
    d.drivingS += t.movingS;
    d.maxSpeedKph = Math.max(d.maxSpeedKph, t.maxSpeedKph);
    map.set(day, d);
  }
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** Guards against CSV/formula injection when a cell comes from user input. */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
