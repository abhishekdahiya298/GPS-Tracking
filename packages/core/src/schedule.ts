/**
 * Pure period logic for scheduled reports.
 *
 * - daily:  covers the previous local calendar day; due from `sendHour` local time today.
 * - weekly: covers the previous local Mon–Sun week; due from `weekday` (1=Mon … 7=Sun)
 *           at `sendHour` in the current week.
 * A period key ("daily:2026-09-24", "weekly:2026-09-14") makes delivery idempotent:
 * the caller sends only when the key differs from the last one sent.
 */
export type ReportFrequency = "daily" | "weekly";

export interface ScheduleSpec {
  frequency: ReportFrequency;
  timeZone: string;
  sendHour: number; // 0–23 local
  weekday: number; // 1–7, used for weekly
}

export interface DuePeriod {
  key: string;
  from: Date; // inclusive, UTC instant of local midnight
  to: Date; // exclusive
  label: string; // e.g. "2026-09-24" or "2026-09-14 – 2026-09-20"
}

interface LocalParts {
  y: number;
  m: number;
  d: number;
  hour: number;
  weekday: number; // 1=Mon … 7=Sun
}

const WD: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function localParts(t: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short"
  }).formatToParts(t);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return { y: +get("year"), m: +get("month"), d: +get("day"), hour: +get("hour") % 24, weekday: WD[get("weekday")]! };
}

/** Offset (ms) of `timeZone` from UTC at instant t. */
function offsetMs(t: number, timeZone: string): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(t));
  const g = (type: string) => +p.find((x) => x.type === type)!.value;
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
  return asUtc - Math.floor(t / 1000) * 1000;
}

/** UTC instant of local wall time y-m-d h:00 in timeZone (DST-safe for whole hours). */
export function zonedTimeToUtc(y: number, m: number, d: number, h: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d, h);
  let t = guess - offsetMs(guess, timeZone);
  t = guess - offsetMs(t, timeZone);
  return new Date(t);
}

/** Calendar arithmetic on a local date (no time zone involved). */
function addDays(y: number, m: number, d: number, n: number): [number, number, number] {
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return [x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()];
}
const ymd = ([y, m, d]: [number, number, number]) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** The period that should have been sent by `now`, or null if the send time hasn't arrived yet. */
export function duePeriod(spec: ScheduleSpec, now: Date): DuePeriod | null {
  const p = localParts(now, spec.timeZone);
  if (spec.frequency === "daily") {
    if (p.hour < spec.sendHour) return null;
    const start = addDays(p.y, p.m, p.d, -1);
    return {
      key: `daily:${ymd(start)}`,
      from: zonedTimeToUtc(...start, 0, spec.timeZone),
      to: zonedTimeToUtc(p.y, p.m, p.d, 0, spec.timeZone),
      label: ymd(start)
    };
  }
  // weekly: has this week's send moment passed?
  if (p.weekday < spec.weekday || (p.weekday === spec.weekday && p.hour < spec.sendHour)) return null;
  const thisMonday = addDays(p.y, p.m, p.d, 1 - p.weekday);
  const lastMonday = addDays(...thisMonday, -7);
  const lastSunday = addDays(...thisMonday, -1);
  return {
    key: `weekly:${ymd(lastMonday)}`,
    from: zonedTimeToUtc(...lastMonday, 0, spec.timeZone),
    to: zonedTimeToUtc(...thisMonday, 0, spec.timeZone),
    label: `${ymd(lastMonday)} – ${ymd(lastSunday)}`
  };
}

/** The most recently completed period regardless of send hour (for "send me a test now"). */
export function latestCompletedPeriod(spec: ScheduleSpec, now: Date): DuePeriod {
  return duePeriod({ ...spec, sendHour: 0, weekday: 1 }, now)!;
}
