/**
 * Time zones and date/time display.
 *
 * Model (same as mainstream fleet platforms):
 * - Every instant is stored in UTC (`timestamptz`); nothing is ever stored in local time.
 * - Each organization has a default IANA time zone and clock format.
 * - Each user may override both (null = use the organization's).
 * - Everything shown to a person (screens, reports, CSV, emails, day boundaries for filters)
 *   uses that person's effective zone, so DST changes are handled by the IANA database and
 *   a trip at 23:30 lands on the right local day.
 *
 * Pure and dependency-free: safe on the server, in the browser and in workers.
 */

export const TIME_FORMATS = ["12h", "24h"] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];

export const DEFAULT_TIME_ZONE = "America/Toronto";
export const DEFAULT_TIME_FORMAT: TimeFormat = "12h";

export interface ZoneOption {
  id: string;
  /** e.g. "Eastern: Toronto, Ottawa, Montréal". */
  label: string;
  region: "Canada" | "United States" | "Other";
  /** True where the zone never changes its clocks (Saskatchewan, Yukon, Arizona, Hawaii…). */
  noDst?: boolean;
}

/**
 * The zones North American fleets actually pick from, in west-to-east order per country.
 * Any other valid IANA zone is still accepted (see `allTimeZones`).
 */
export const NORTH_AMERICA_ZONES: readonly ZoneOption[] = [
  { id: "America/Vancouver", label: "Pacific: Vancouver, Victoria", region: "Canada" },
  { id: "America/Whitehorse", label: "Yukon: Whitehorse, Dawson", region: "Canada", noDst: true },
  { id: "America/Edmonton", label: "Mountain: Edmonton, Calgary, Yellowknife", region: "Canada" },
  { id: "America/Regina", label: "Saskatchewan: Regina, Saskatoon", region: "Canada", noDst: true },
  { id: "America/Winnipeg", label: "Central: Winnipeg", region: "Canada" },
  { id: "America/Toronto", label: "Eastern: Toronto, Ottawa, Montréal", region: "Canada" },
  { id: "America/Halifax", label: "Atlantic: Halifax, Moncton, Charlottetown", region: "Canada" },
  { id: "America/St_Johns", label: "Newfoundland: St. John's", region: "Canada" },
  { id: "Pacific/Honolulu", label: "Hawaii: Honolulu", region: "United States", noDst: true },
  { id: "America/Anchorage", label: "Alaska: Anchorage", region: "United States" },
  { id: "America/Los_Angeles", label: "Pacific: Los Angeles, Seattle, Las Vegas", region: "United States" },
  { id: "America/Phoenix", label: "Arizona: Phoenix", region: "United States", noDst: true },
  { id: "America/Denver", label: "Mountain: Denver, Salt Lake City, Boise", region: "United States" },
  { id: "America/Chicago", label: "Central: Chicago, Dallas, Houston", region: "United States" },
  { id: "America/New_York", label: "Eastern: New York, Atlanta, Miami", region: "United States" },
  { id: "America/Puerto_Rico", label: "Atlantic: Puerto Rico", region: "United States", noDst: true },
  { id: "UTC", label: "UTC (Coordinated Universal Time)", region: "Other", noDst: true }
];

const BY_ID = new Map(NORTH_AMERICA_ZONES.map((z) => [z.id, z]));

/**
 * The canonical IANA name for `tz` ("US/Eastern" → "America/New_York",
 * "america/toronto" → "America/Toronto"), or null when the runtime doesn't know it.
 */
export function canonicalTimeZone(tz: unknown): string | null {
  if (typeof tz !== "string") return null;
  const t = tz.trim();
  if (!t || t.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(t)) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: t }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export function isValidTimeZone(tz: unknown): tz is string {
  return canonicalTimeZone(tz) !== null;
}

/** Every IANA zone the runtime supports (falls back to the curated list on old runtimes). */
export function allTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  try {
    const list = intl.supportedValuesOf?.("timeZone");
    if (list && list.length) return list.includes("UTC") ? list : [...list, "UTC"];
  } catch {
    /* older runtime */
  }
  return NORTH_AMERICA_ZONES.map((z) => z.id);
}

const clean = (s: string) => s.replace(/[\u202f\u00a0]/g, " ");

type Instant = string | number | Date;
const toDate = (v: Instant) => (v instanceof Date ? v : new Date(v));

const zoneNameCache = new Map<string, Intl.DateTimeFormat>();
function zoneNamePart(tz: string, locale: string, style: "short" | "shortOffset", at: Date): string {
  const key = `${tz}|${locale}|${style}`;
  let f = zoneNameCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: style });
    zoneNameCache.set(key, f);
  }
  return f.formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "";
}

/** Offset label such as "UTC−4", "UTC−3:30" or "UTC". */
export function zoneOffset(tz: string, at: Instant = Date.now()): string {
  const raw = zoneNamePart(tz, "en-US", "shortOffset", toDate(at)); // "GMT-4", "GMT-2:30", "GMT"
  const m = /^GMT([+-])?(\d{1,2})(?::(\d{2}))?$/.exec(raw);
  if (!m || !m[1] || (Number(m[2]) === 0 && (!m[3] || m[3] === "00"))) return "UTC";
  return `UTC${m[1] === "-" ? "−" : "+"}${Number(m[2])}${m[3] && m[3] !== "00" ? `:${m[3]}` : ""}`;
}

/** Zones whose CLDR name has no abbreviation but that North Americans abbreviate anyway. */
const ABBR_OVERRIDE: Record<string, string> = { "America/Whitehorse": "MST", "America/Dawson": "MST" };

/**
 * Short zone abbreviation for an instant, DST-aware: "EDT", "PST", "NDT", "AKST"…
 * Letter abbreviations are used only for the curated North American zones, where every
 * runtime's ICU data agrees; elsewhere the numeric offset ("UTC+5:30") is used, because
 * Node and browsers disagree on names like "IST" (it would also break hydration).
 */
export function zoneAbbr(tz: string, at: Instant = Date.now()): string {
  if (tz === "UTC" || tz === "Etc/UTC") return "UTC";
  if (ABBR_OVERRIDE[tz]) return ABBR_OVERRIDE[tz]!;
  const d = toDate(at);
  if (!BY_ID.has(tz)) return zoneOffset(tz, d);
  for (const locale of ["en-US", "en-CA"]) {
    const s = zoneNamePart(tz, locale, "short", d);
    if (s && !s.startsWith("GMT") && !s.startsWith("UTC")) return s;
  }
  return zoneOffset(tz, d);
}

/** Human label for a zone: the curated label, else the IANA id made readable. */
export function zoneLabel(tz: string): string {
  return BY_ID.get(tz)?.label ?? tz.replace(/_/g, " ");
}

/** "Eastern: Toronto, Ottawa, Montréal (EDT, UTC−4)" at the given instant. */
export function zoneOptionLabel(tz: string, at: Instant = Date.now()): string {
  const abbr = zoneAbbr(tz, at);
  const off = zoneOffset(tz, at);
  return `${zoneLabel(tz)} (${abbr === off ? off : `${abbr}, ${off}`})`;
}

export function zoneOption(tz: string): ZoneOption | undefined {
  return BY_ID.get(tz);
}

/** Effective zone and clock: the user's own choice, else the organization's. */
export function effectiveTimePrefs(
  org: { timeZone: string; timeFormat: TimeFormat },
  user: { timeZone: string | null; timeFormat: TimeFormat | null } | null | undefined
): { timeZone: string; timeFormat: TimeFormat } {
  const tz = canonicalTimeZone(user?.timeZone ?? null) ?? canonicalTimeZone(org.timeZone) ?? DEFAULT_TIME_ZONE;
  return { timeZone: tz, timeFormat: user?.timeFormat ?? org.timeFormat ?? DEFAULT_TIME_FORMAT };
}

export interface DateFormatter {
  timeZone: string;
  timeFormat: TimeFormat;
  /** "Sep 25, 3:52 PM" */
  dateTime(v: Instant): string;
  /** "Sep 25, 2026, 3:52:07 PM EDT": for details and tooltips. */
  full(v: Instant): string;
  /** "Sep 25, 2026" */
  date(v: Instant): string;
  /** "3:52 PM" */
  time(v: Instant): string;
  /** "3:52:07 PM" */
  timeSec(v: Instant): string;
  /** "Sep 25, 3:52:07 PM" */
  dateTimeSec(v: Instant): string;
  /** "2026-09-25 15:52": for CSV (sortable, unambiguous). */
  iso(v: Instant): string;
  /** Local calendar day "YYYY-MM-DD". */
  dayKey(v: Instant): string;
  /** "Fri, Sep 25" for a "YYYY-MM-DD" day key (no zone maths: it is already local). */
  day(dayKey: string): string;
  /** "Sep 2026" for a "YYYY-MM" month key. */
  month(monthKey: string): string;
  /** "EDT" at that instant. */
  abbr(v?: Instant): string;
}

const formatterCache = new Map<string, DateFormatter>();

/**
 * Cached formatter for a zone + clock. Intl.DateTimeFormat construction is the expensive
 * part; tables with thousands of rows reuse the same instances.
 */
export function dateFormatter(timeZone: string, timeFormat: TimeFormat = DEFAULT_TIME_FORMAT): DateFormatter {
  const tz = canonicalTimeZone(timeZone) ?? "UTC";
  const key = `${tz}|${timeFormat}`;
  const hit = formatterCache.get(key);
  if (hit) return hit;
  const hc = timeFormat === "24h" ? ({ hourCycle: "h23" } as const) : ({ hour12: true } as const);
  const mk = (o: Intl.DateTimeFormatOptions) => {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, ...o });
    return (v: Instant) => clean(f.format(toDate(v)));
  };
  const dateTime = mk({ month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...hc });
  const dateTimeSec = mk({ month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", ...hc });
  const fullNoZone = mk({ month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", ...hc });
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
  const monthFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", year: "numeric" });
  const pick = (v: Instant) => {
    const p: Record<string, string> = {};
    for (const x of parts.formatToParts(toDate(v))) p[x.type] = x.value;
    return p;
  };
  const f: DateFormatter = {
    timeZone: tz,
    timeFormat,
    dateTime,
    dateTimeSec,
    full: (v) => `${fullNoZone(v)} ${zoneAbbr(tz, toDate(v))}`,
    date: mk({ month: "short", day: "numeric", year: "numeric" }),
    time: mk({ hour: "numeric", minute: "2-digit", ...hc }),
    timeSec: mk({ hour: "numeric", minute: "2-digit", second: "2-digit", ...hc }),
    iso: (v) => {
      const p = pick(v);
      return `${p.year}-${p.month}-${p.day} ${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
    },
    dayKey: (v) => {
      const p = pick(v);
      return `${p.year}-${p.month}-${p.day}`;
    },
    day: (k) => clean(dayFmt.format(new Date(`${k}T12:00:00Z`))),
    month: (k) => clean(monthFmt.format(new Date(`${k}-15T12:00:00Z`))),
    abbr: (v = Date.now()) => zoneAbbr(tz, v)
  };
  formatterCache.set(key, f);
  return f;
}

const offsetFmtCache = new Map<string, Intl.DateTimeFormat>();
/** Offset of `tz` from UTC (ms) at instant t. */
function offsetAt(t: number, tz: string): number {
  let f = offsetFmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    offsetFmtCache.set(tz, f);
  }
  const whole = t - (((t % 1000) + 1000) % 1000);
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(whole)) if (x.type !== "literal") p[x.type] = Number(x.value);
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!, p.second!) - whole;
}

/**
 * UTC instant of a wall-clock time ("YYYY-MM-DDTHH:mm" or "YYYY-MM-DD") in `tz`, DST-safe.
 * Same rule as browsers and Temporal's "compatible": a time skipped by spring-forward
 * resolves to the instant after the gap; a repeated fall-back time resolves to the first one.
 */
export function wallTimeToUtc(local: string, tz: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(local.trim());
  if (!m) return new Date(NaN);
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  // Offsets a day either side (transitions are never that close together).
  const before = offsetAt(wall - 86_400_000, tz);
  const after = offsetAt(wall + 86_400_000, tz);
  const valid = [...new Set([before, after])].map((o) => wall - o).filter((t) => offsetAt(t, tz) === wall - t);
  if (valid.length) return new Date(Math.min(...valid));
  return new Date(wall - before); // in a gap: shift forward by the gap
}

/** Wall-clock "YYYY-MM-DDTHH:mm" of an instant in `tz` (for datetime-local inputs). */
export function toWallTime(v: Instant, tz: string): string {
  return dateFormatter(tz, "24h").iso(v).replace(" ", "T");
}

/** UTC instant of local midnight at the start of `day` (YYYY-MM-DD) in `tz`; DST-safe. */
export function startOfLocalDay(day: string, tz: string): Date {
  return wallTimeToUtc(`${day}T00:00`, tz);
}

/** Calendar arithmetic on day keys: addDays("2026-12-31", 1) → "2027-01-01". */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Next calendar day key: "2026-11-01" → "2026-11-02". */
export function nextDayKey(day: string): string {
  return addDays(day, 1);
}
