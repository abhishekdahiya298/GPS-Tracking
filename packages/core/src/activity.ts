import { haversineMeters } from "./geo.js";
import { TRIP_DEFAULTS, localDay, splitTrips, type TrackPoint, type Trip } from "./trips.js";

/**
 * Activity reports derived from a time-ordered GPS track. Pure functions: nothing here
 * reads or changes stored data. Trips come from the same engine as the Trip report, so
 * stops and mileage always agree with it.
 */

export interface Stop {
  startT: number;
  /** null while the vehicle is still stopped at the end of the data. */
  endT: number | null;
  durationS: number;
  lat: number;
  lon: number;
}

/**
 * Stops are the time between trips: from the end of one trip to the start of the next.
 * The last stop is "ongoing" (endT null) and lasts until `untilT` (normally the end of the
 * requested range, capped at now). Stops shorter than `minMinutes` are left out.
 */
export function detectStops(trips: Trip[], untilT: number, minMinutes = 5): Stop[] {
  const out: Stop[] = [];
  const min = minMinutes * 60;
  for (let i = 0; i < trips.length; i++) {
    const end = trips[i]!.end;
    const next = trips[i + 1];
    const endT = next ? next.start.t : null;
    const durationS = Math.round(((endT ?? untilT) - end.t) / 1000);
    if (durationS >= min) out.push({ startT: end.t, endT, durationS, lat: end.lat, lon: end.lon });
  }
  return out;
}

export interface IdlePeriod {
  startT: number;
  endT: number;
  durationS: number;
  lat: number;
  lon: number;
}

/**
 * Idling = ignition on while not moving (speed below IDLE_KPH). Needs an ignition signal:
 * points with unknown ignition never count. A period ends when the vehicle moves, the
 * ignition turns off, or data stops for longer than GAP_MINUTES (the period then ends at
 * the last idle point, so missing data is never counted as idling).
 */
export function detectIdling(points: TrackPoint[], minMinutes = 5, opts: Partial<typeof TRIP_DEFAULTS> = {}): IdlePeriod[] {
  const o = { ...TRIP_DEFAULTS, ...opts };
  const out: IdlePeriod[] = [];
  const min = minMinutes * 60;
  let start: TrackPoint | null = null;
  let last: TrackPoint | null = null;
  const close = (endT: number) => {
    if (start) {
      const durationS = Math.round((endT - start.t) / 1000);
      if (durationS >= min) out.push({ startT: start.t, endT, durationS, lat: start.lat, lon: start.lon });
    }
    start = null;
    last = null;
  };
  const idle = (p: TrackPoint) => p.ignition === true && (p.speedKph ?? 0) < o.IDLE_KPH;
  for (const p of points) {
    if (start && last && p.t - last.t > o.GAP_MINUTES * 60_000) close(last.t);
    if (idle(p)) {
      start ??= p;
      last = p;
    } else if (start) {
      close(p.t); // idling lasted until this (moving or ignition-off) point
    }
  }
  if (start && last) close((last as TrackPoint).t);
  return out;
}

export interface SpeedingEvent {
  startT: number;
  endT: number;
  durationS: number;
  maxSpeedKph: number;
  points: number;
  /** Where the top speed was recorded. */
  lat: number;
  lon: number;
}

/**
 * Speeding = consecutive points above `limitKph`. One event per continuous stretch; a point
 * at or below the limit, or a data gap, ends it. A single point above the limit is an event
 * with duration 0 (trackers that report every few minutes would otherwise hide speeding).
 */
export function detectSpeeding(points: TrackPoint[], limitKph: number, opts: Partial<typeof TRIP_DEFAULTS> = {}): SpeedingEvent[] {
  const o = { ...TRIP_DEFAULTS, ...opts };
  const out: SpeedingEvent[] = [];
  let run: TrackPoint[] = [];
  const close = () => {
    if (run.length) {
      const top = run.reduce((a, p) => ((p.speedKph ?? 0) > (a.speedKph ?? 0) ? p : a));
      const first = run[0]!;
      const lastP = run[run.length - 1]!;
      out.push({ startT: first.t, endT: lastP.t, durationS: Math.round((lastP.t - first.t) / 1000), maxSpeedKph: Math.round(top.speedKph ?? 0), points: run.length, lat: top.lat, lon: top.lon });
    }
    run = [];
  };
  for (const p of points) {
    const prev = run[run.length - 1];
    if (prev && p.t - prev.t > o.GAP_MINUTES * 60_000) close();
    const v = p.speedKph ?? 0;
    // Implausible readings are GPS glitches, not speeding.
    if (v > limitKph && v <= o.MAX_PLAUSIBLE_KPH) run.push(p);
    else close();
  }
  close();
  return out;
}

export interface DayMileage {
  day: string;
  distanceM: number;
  drivingS: number;
  idleS: number;
  trips: number;
}

/**
 * Distance and driving time per local calendar day. Each segment of each trip is credited
 * to the day it starts in, so a trip across midnight is split between both days, and the
 * total equals the Trip report's total for the same range. `trips` counts trips by start day.
 */
export function mileageByDay(points: TrackPoint[], timeZone: string, opts: Partial<typeof TRIP_DEFAULTS> = {}): DayMileage[] {
  const o = { ...TRIP_DEFAULTS, ...opts };
  const map = new Map<string, DayMileage>();
  const get = (day: string) => {
    let d = map.get(day);
    if (!d) map.set(day, (d = { day, distanceM: 0, drivingS: 0, idleS: 0, trips: 0 }));
    return d;
  };
  // Day lookups are the hot path on long ranges: cache per UTC hour (zones are whole
  // multiples of 15 minutes, so a day never changes inside a quarter hour).
  const cache = new Map<number, string>();
  const dayOf = (t: number) => {
    const k = Math.floor(t / 900_000);
    let d = cache.get(k);
    if (!d) cache.set(k, (d = localDay(t, timeZone)));
    return d;
  };
  for (const { points: pts } of splitTrips(points, opts)) {
    get(dayOf(pts[0]!.t)).trips++;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const p = pts[i]!;
      const dt = (p.t - a.t) / 1000;
      if (dt <= 0) continue;
      const day = get(dayOf(a.t));
      const d = haversineMeters([a.lon, a.lat], [p.lon, p.lat]);
      if ((d / dt) * 3.6 <= o.MAX_PLAUSIBLE_KPH) day.distanceM += d;
      if ((a.speedKph ?? 0) < o.IDLE_KPH && a.ignition === true) day.idleS += dt;
      else day.drivingS += dt;
    }
  }
  return [...map.values()]
    .map((d) => ({ ...d, distanceM: Math.round(d.distanceM), drivingS: Math.round(d.drivingS), idleS: Math.round(d.idleS) }))
    .sort((a, b) => a.day.localeCompare(b.day));
}
