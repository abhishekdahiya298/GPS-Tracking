/**
 * Tracker diagnostics (Platform console): turns Traccar's raw stored reports into what a person
 * needs when a tracker misbehaves. Pure functions only (no I/O), shared by the server and page.
 *
 * Traccar keeps every report, including the ones RIO drops (no GNSS fix, 0,0), with the
 * device's sensor values. Attribute names are Traccar's (Teltonika decoder):
 * sat = satellites in use, hdop/pdop = GPS accuracy, io69 = GNSS state, power = external
 * voltage (V), battery = internal battery (V), rssi = cell signal 0..5, result = command reply.
 */
import { z } from "zod";

/** Read-only Teltonika commands the console may send. Nothing that restarts or reconfigures. */
export const TRACKER_COMMANDS = [
  { id: "getgps", label: "GPS status", explains: "Satellites, fix, position and GPS time" },
  { id: "getinfo", label: "Device info", explains: "Start time, uptime, GNSS state, time without GPS" },
  { id: "getstatus", label: "Network", explains: "Data link, operator, signal, roaming" },
  { id: "battery", label: "Power and battery", explains: "External voltage and internal battery" },
  { id: "getver", label: "Firmware", explains: "Firmware, GPS chip and hardware version" },
  { id: "getio", label: "Inputs and outputs", explains: "Digital and analog inputs, outputs" }
] as const;
export type TrackerCommandId = (typeof TRACKER_COMMANDS)[number]["id"];
export const TrackerCommandSchema = z.object({ command: z.enum(TRACKER_COMMANDS.map((c) => c.id) as [TrackerCommandId, ...TrackerCommandId[]]) });

/** One report as the page shows it. Missing sensor values stay null ("not reported"). */
export interface DiagReport {
  /** When the tracker recorded it (device clock). */
  at: string;
  /** When our server received it. */
  receivedAt: string;
  /** A usable GNSS position (valid flag set and not 0,0). */
  fix: boolean;
  latitude: number;
  longitude: number;
  speedKph: number;
  course: number | null;
  satellites: number | null;
  hdop: number | null;
  /** Teltonika io69: 0 off, 1 on with fix, 2 on without fix, 3 sleeping. */
  gnssState: number | null;
  externalV: number | null;
  batteryV: number | null;
  ignition: boolean | null;
  motion: boolean | null;
  /** Cell signal 0..5. */
  signal: number | null;
  /** Reply to a command, when this report carries one. */
  result: string | null;
  protocol: string | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

const RawPosition = z.object({
  deviceTime: z.string().optional(),
  fixTime: z.string().optional(),
  serverTime: z.string().optional(),
  valid: z.boolean().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  speed: z.number().optional(),
  course: z.number().optional(),
  protocol: z.string().optional(),
  attributes: z.record(z.unknown()).optional()
});

/** One Traccar position → DiagReport; null when it isn't a position at all. */
export function toDiagReport(raw: unknown): DiagReport | null {
  const p = RawPosition.safeParse(raw);
  if (!p.success) return null;
  const d = p.data;
  const at = d.deviceTime ?? d.fixTime ?? d.serverTime;
  if (!at) return null;
  const a = d.attributes ?? {};
  const lat = d.latitude ?? 0;
  const lon = d.longitude ?? 0;
  const result = typeof a.result === "string" && a.result.trim() ? a.result.trim() : null;
  return {
    at,
    receivedAt: d.serverTime ?? at,
    fix: d.valid === true && !(lat === 0 && lon === 0),
    latitude: lat,
    longitude: lon,
    speedKph: Math.round((d.speed ?? 0) * 1.852 * 10) / 10,
    course: num(d.course),
    satellites: num(a.sat),
    hdop: num(a.hdop),
    gnssState: num(a.io69),
    externalV: num(a.power),
    batteryV: num(a.battery),
    ignition: bool(a.ignition),
    motion: bool(a.motion),
    signal: num(a.rssi),
    result,
    protocol: d.protocol ?? null
  };
}

/** Teltonika command replies are "Key:Value Key:Value …": split into pairs for display. */
export function parseReply(text: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  const re = /([A-Za-z][A-Za-z0-9 ]{0,20}?):\s*(\S+)/g;
  for (const m of text.matchAll(re)) out.push({ key: m[1]!.trim(), value: m[2]! });
  return out;
}

export interface HourBucket {
  /** Start of the hour (ISO). */
  start: string;
  reports: number;
  fixes: number;
  maxSatellites: number | null;
  minExternalV: number | null;
  minBatteryV: number | null;
}

/** Reports per hour over [from, to): what the timeline strip and charts draw. */
export function hourlyBuckets(reports: DiagReport[], from: Date, to: Date): HourBucket[] {
  const HOUR = 3_600_000;
  const first = Math.floor(from.getTime() / HOUR) * HOUR;
  const n = Math.max(1, Math.ceil((to.getTime() - first) / HOUR));
  const buckets: HourBucket[] = Array.from({ length: n }, (_, i) => ({ start: new Date(first + i * HOUR).toISOString(), reports: 0, fixes: 0, maxSatellites: null, minExternalV: null, minBatteryV: null }));
  for (const r of reports) {
    const i = Math.floor((Date.parse(r.at) - first) / HOUR);
    const b = buckets[i];
    if (!b) continue;
    b.reports++;
    if (r.fix) b.fixes++;
    if (r.satellites !== null) b.maxSatellites = Math.max(b.maxSatellites ?? 0, r.satellites);
    if (r.externalV !== null) b.minExternalV = b.minExternalV === null ? r.externalV : Math.min(b.minExternalV, r.externalV);
    if (r.batteryV !== null) b.minBatteryV = b.minBatteryV === null ? r.batteryV : Math.min(b.minBatteryV, r.batteryV);
  }
  return buckets;
}

export type Level = "ok" | "warn" | "bad" | "unknown";

/** One health check card: a level, a short value and a plain sentence. */
export interface HealthCheck {
  id: "connection" | "gps" | "power" | "battery" | "signal";
  label: string;
  level: Level;
  value: string;
  detail: string;
}

export interface DiagnoseInput {
  now: number;
  /** RIO's last_seen (any report, fix or not). */
  lastSeenAt: string | null;
  /** Reports in the window, oldest first. */
  reports: DiagReport[];
  /** Newest usable fix RIO knows (may be older than the window). */
  lastFixAt: string | null;
  offlineSeconds: number;
}

/** Voltage under which a vehicle's external power counts as cut. */
export const EXTERNAL_POWER_MIN_V = 6;
/** Internal battery voltage under which it is running low (Li-ion, ~20 %). */
export const BATTERY_LOW_V = 3.6;
/** How long without a fix while reporting before GPS counts as failing. */
export const NO_FIX_ALERT_MS = 30 * 60_000;

export function ago(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60 ? `${m % 60} min` : ""}`.trim();
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/** The five health checks, each with a plain-language explanation. */
export function healthChecks(input: DiagnoseInput): HealthCheck[] {
  const { now, reports } = input;
  const latest = reports[reports.length - 1] ?? null;
  const seenMs = input.lastSeenAt ? now - Date.parse(input.lastSeenAt) : null;
  const online = seenMs !== null && seenMs <= input.offlineSeconds * 1000;

  const connection: HealthCheck =
    seenMs === null
      ? { id: "connection", label: "Connection", level: "unknown", value: "Never", detail: "This tracker has never reported to RIO." }
      : online
        ? { id: "connection", label: "Connection", level: "ok", value: `${ago(seenMs)} ago`, detail: "Reporting normally to the server." }
        : { id: "connection", label: "Connection", level: "bad", value: `${ago(seenMs)} ago`, detail: "Not reporting. It is switched off, without power and battery, or without cell signal." };

  const fixMs = input.lastFixAt ? now - Date.parse(input.lastFixAt) : null;
  let gps: HealthCheck;
  if (!latest) gps = { id: "gps", label: "GPS", level: "unknown", value: "No data", detail: "No reports in this time range." };
  else if (latest.fix) {
    gps = { id: "gps", label: "GPS", level: "ok", value: latest.satellites !== null ? `${latest.satellites} satellites` : "Fix", detail: "Has a valid position." };
  } else {
    const sats = latest.satellites ?? 0;
    const since = fixMs !== null ? `for ${ago(fixMs)}` : "in this time range";
    const moving = reports.slice(-30).some((r) => r.motion === true);
    gps = {
      id: "gps",
      label: "GPS",
      level: fixMs === null || fixMs > NO_FIX_ALERT_MS ? "bad" : "warn",
      value: `${sats} satellites`,
      detail: `No GPS position ${since}${moving ? " while the vehicle is moving" : ""}. Usually the unit is covered or under metal, or its GPS part has failed.`
    };
  }

  const v = [...reports].reverse().find((r) => r.externalV !== null)?.externalV ?? null;
  const power: HealthCheck =
    v === null
      ? { id: "power", label: "External power", level: "unknown", value: "Not reported", detail: "Not in the tracker's reports. Use the Power and battery command." }
      : v < EXTERNAL_POWER_MIN_V
        ? { id: "power", label: "External power", level: "warn", value: `${v.toFixed(1)} V`, detail: "No power from the vehicle: running on its internal battery." }
        : { id: "power", label: "External power", level: "ok", value: `${v.toFixed(1)} V`, detail: "Powered by the vehicle." };

  const b = [...reports].reverse().find((r) => r.batteryV !== null)?.batteryV ?? null;
  const battery: HealthCheck =
    b === null
      ? { id: "battery", label: "Internal battery", level: "unknown", value: "Not reported", detail: "Not in the tracker's reports." }
      : b < BATTERY_LOW_V
        ? { id: "battery", label: "Internal battery", level: "bad", value: `${b.toFixed(2)} V`, detail: "Low. Without vehicle power it will switch off soon." }
        : { id: "battery", label: "Internal battery", level: "ok", value: `${b.toFixed(2)} V`, detail: "Charged enough." };

  const s = [...reports].reverse().find((r) => r.signal !== null)?.signal ?? null;
  const signal: HealthCheck =
    s === null
      ? { id: "signal", label: "Cell signal", level: "unknown", value: "Not reported", detail: "Not in the tracker's reports." }
      : s <= 1
        ? { id: "signal", label: "Cell signal", level: "warn", value: `${s} of 5`, detail: "Weak. Reports may be delayed." }
        : { id: "signal", label: "Cell signal", level: "ok", value: `${s} of 5`, detail: "Good enough to report." };

  return [connection, gps, power, battery, signal];
}

/** One-line summary for the top of the page: the worst finding, or "healthy". */
export function overallVerdict(checks: HealthCheck[]): { level: Level; title: string; detail: string } {
  const bad = checks.filter((c) => c.level === "bad");
  const warn = checks.filter((c) => c.level === "warn");
  if (bad.length) return { level: "bad", title: `Needs attention: ${bad.map((c) => c.label).join(", ")}`, detail: [...bad, ...warn].map((c) => c.detail).join(" ") };
  if (warn.length) return { level: "warn", title: `Check: ${warn.map((c) => c.label).join(", ")}`, detail: warn.map((c) => c.detail).join(" ") };
  if (checks.every((c) => c.level === "unknown")) return { level: "unknown", title: "No data yet", detail: "Nothing has been received from this tracker in this time range." };
  return { level: "ok", title: "Healthy", detail: "Reporting, with GPS, power and signal all fine." };
}
