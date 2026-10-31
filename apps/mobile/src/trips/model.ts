/**
 * Trip history: the server's shapes, the day picker's arithmetic and the playback maths.
 * Pure TypeScript, unit-tested. Days are calendar days in the organization's time zone.
 */
import { addDays, dateFormatter, startOfLocalDay } from "@rio-gps/core/timezones";

export interface TripDto {
  startAt: string;
  endAt: string;
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  distanceKm: number;
  durationMin: number;
  drivingMin: number;
  idleMin: number;
  maxSpeedKph: number;
  avgMovingKph: number;
}

export interface TripReport {
  deviceId: string;
  from: string;
  to: string;
  timeZone: string;
  trips: TripDto[];
  totals: { trips: number; distanceKm: number; drivingMin: number; maxSpeedKph: number };
}

export interface HistoryPoint {
  latitude: number;
  longitude: number;
  speedKph: number | null;
  headingDeg: number | null;
  recordedAt: string;
}
export interface HistoryPage {
  points: HistoryPoint[];
  nextCursor: string | null;
}

/** Today's calendar day (YYYY-MM-DD) in a time zone. */
export function todayKey(timeZone: string, now: number = Date.now()): string {
  return dateFormatter(timeZone, "24h").dayKey(now);
}

/** The instants a local day starts and ends (DST days are 23 or 25 hours long). */
export function dayRange(day: string, timeZone: string): { from: string; to: string } {
  return { from: startOfLocalDay(day, timeZone).toISOString(), to: startOfLocalDay(addDays(day, 1), timeZone).toISOString() };
}

/** Moves the picker by whole days, never past today. */
export function shiftDay(day: string, by: number, today: string): string {
  const next = addDays(day, by);
  return next > today ? today : next;
}

export function dayLabel(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(`${day}T12:00:00Z`));
}

/** "45 min", "2 h 05 min". */
export function durationText(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

// ---- playback ----------------------------------------------------------------------------

export interface Track {
  /** Epoch ms per point, strictly increasing. */
  t: number[];
  /** [longitude, latitude] per point. */
  at: [number, number][];
  speedKph: (number | null)[];
  startT: number;
  endT: number;
}

/** Cleans a history response into a track: valid positions only, in time order, one per instant. */
export function buildTrack(points: HistoryPoint[]): Track | null {
  const rows = points
    .map((p) => ({ t: Date.parse(p.recordedAt), lng: p.longitude, lat: p.latitude, speedKph: p.speedKph }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.lat) && Number.isFinite(p.lng) && !(p.lat === 0 && p.lng === 0))
    .sort((a, b) => a.t - b.t)
    .filter((p, i, all) => i === 0 || p.t > all[i - 1]!.t);
  if (rows.length < 2) return null;
  return { t: rows.map((r) => r.t), at: rows.map((r) => [r.lng, r.lat]), speedKph: rows.map((r) => r.speedKph), startT: rows[0]!.t, endT: rows[rows.length - 1]!.t };
}

export interface Playhead {
  at: [number, number];
  speedKph: number | null;
  /** Index of the last point at or before the playhead. */
  index: number;
}

/** Where the vehicle was at time `t`, moving in a straight line between recorded points. */
export function positionAt(track: Track, t: number): Playhead {
  const last = track.t.length - 1;
  if (t <= track.startT) return { at: track.at[0]!, speedKph: track.speedKph[0] ?? null, index: 0 };
  if (t >= track.endT) return { at: track.at[last]!, speedKph: track.speedKph[last] ?? null, index: last };
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track.t[mid]! <= t) lo = mid;
    else hi = mid;
  }
  const f = (t - track.t[lo]!) / (track.t[hi]! - track.t[lo]!);
  const a = track.at[lo]!;
  const b = track.at[hi]!;
  return { at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], speedKph: track.speedKph[lo] ?? null, index: lo };
}

export function trackBounds(track: Track, minSpanDeg = 0.01): [number, number, number, number] {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const [lng, lat] of track.at) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  if (east - west < minSpanDeg) {
    const mid = (east + west) / 2;
    west = mid - minSpanDeg / 2;
    east = mid + minSpanDeg / 2;
  }
  if (north - south < minSpanDeg) {
    const mid = (north + south) / 2;
    south = mid - minSpanDeg / 2;
    north = mid + minSpanDeg / 2;
  }
  return [west, south, east, north];
}

/**
 * Playback speed. "1x" plays any trip in about a minute, however long it really took,
 * so a 20-minute delivery and a 6-hour haul are both comfortable to watch.
 */
export const SPEEDS = [1, 2, 4] as const;
export const BASE_PLAY_SECONDS = 60;

/** Advances the playhead by `elapsedMs` of real time. Stops exactly at the end. */
export function advance(track: Track, t: number, elapsedMs: number, speed: number): number {
  const rate = (track.endT - track.startT) / (BASE_PLAY_SECONDS * 1000);
  return Math.min(track.endT, Math.max(track.startT, t + elapsedMs * rate * speed));
}

export function progressOf(track: Track, t: number): number {
  return Math.min(1, Math.max(0, (t - track.startT) / (track.endT - track.startT)));
}
export function timeAtProgress(track: Track, fraction: number): number {
  return track.startT + Math.min(1, Math.max(0, fraction)) * (track.endT - track.startT);
}
