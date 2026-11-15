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

/** "45 min", "2 h 05 min", "2 d 8 h". */
export function durationText(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  if (m >= 1440) return `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`;
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

/** Great-circle distance between two [lng, lat] points, in km. */
function legKm(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distance, duration and top speed of a recorded route, from its own points. */
export function trackSummary(track: Track): { distanceKm: number; durationMs: number; maxSpeedKph: number | null } {
  let km = 0;
  for (let i = 1; i < track.at.length; i++) km += legKm(track.at[i - 1]!, track.at[i]!);
  const speeds = track.speedKph.filter((v): v is number => v !== null && Number.isFinite(v));
  return { distanceKm: km, durationMs: track.endT - track.startT, maxSpeedKph: speeds.length ? Math.max(...speeds) : null };
}


/** Below this a vehicle counts as standing (GPS jitter can read a few km/h at rest). */
const STILL_KPH = 5;

/**
 * Since when the vehicle has been standing, from its recorded points (oldest first): the time of
 * the first point after its last movement. Null when the latest point is moving or there are no
 * points. When it stood still for the whole window, `whole` is true ("here for 12 h+").
 */
export function stillSince(points: HistoryPoint[]): { since: number; whole: boolean } | null {
  if (points.length === 0) return null;
  const moving = (p: HistoryPoint) => (p.speedKph ?? 0) >= STILL_KPH;
  if (moving(points[points.length - 1]!)) return null;
  for (let i = points.length - 1; i >= 0; i--) {
    if (moving(points[i]!)) return { since: Date.parse(points[i + 1]!.recordedAt), whole: false };
  }
  return { since: Date.parse(points[0]!.recordedAt), whole: true };
}

/**
 * Stops inside a trip, read from its own points: places where the vehicle stayed within about
 * 40 m for at least `minMinutes`. The start and end are left out (they are A and B already).
 */
export function trackStops(track: Track, minMinutes = 5): { at: [number, number]; from: number; to: number }[] {
  const out: { at: [number, number]; from: number; to: number }[] = [];
  const near = (a: [number, number], b: [number, number]) => {
    const dy = (a[1] - b[1]) * 111_320;
    const dx = (a[0] - b[0]) * 111_320 * Math.cos((a[1] * Math.PI) / 180);
    return Math.hypot(dx, dy) <= 40;
  };
  const n = track.at.length;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && near(track.at[i]!, track.at[j + 1]!)) j++;
    const minutes = (track.t[j]! - track.t[i]!) / 60000;
    if (j > i && minutes >= minMinutes && i > 0 && j < n - 1) out.push({ at: track.at[i]!, from: track.t[i]!, to: track.t[j]! });
    i = j + 1;
  }
  return out;
}
