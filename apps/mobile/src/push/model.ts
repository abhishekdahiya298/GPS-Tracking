/**
 * Push notification choices and the pure logic around them. No React Native imports,
 * so this is unit-tested. The phone-specific part is in service.ts.
 */
export interface PushPrefs {
  /** Master switch: off means this phone is not registered with the server at all. */
  enabled: boolean;
  speeding: boolean;
  zones: boolean;
  offline: boolean;
  loads: boolean;
  /** Quiet hours: no notifications between these two times of day (the alerts still appear in the app). */
  quiet: boolean;
  /** Minutes after midnight, phone's local time. The quiet time may run past midnight (22:00 to 06:00). */
  quietStart: number;
  quietEnd: number;
}

export const DEFAULT_PREFS: PushPrefs = { enabled: false, speeding: true, zones: true, offline: true, loads: true, quiet: false, quietStart: 22 * 60, quietEnd: 6 * 60 };

const DAY = 24 * 60;
/** Keeps a time of day inside 0..1439, wrapping around midnight. */
export const wrapMinutes = (m: number): number => ((Math.round(m) % DAY) + DAY) % DAY;

/** "10:00 PM" or "22:00". */
export function clockText(minutes: number, style: "12h" | "24h"): string {
  const m = wrapMinutes(minutes);
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  if (style === "24h") return `${String(h).padStart(2, "0")}:${mm}`;
  return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? "AM" : "PM"}`;
}

/** True when `now` (minutes after midnight) falls in the quiet time. Start = end means never quiet. */
export function isQuiet(now: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

export const PUSH_KINDS: Array<{ key: "speeding" | "zones" | "offline" | "loads"; label: string; note: string }> = [
  { key: "speeding", label: "Speeding", note: "A vehicle goes over a speed limit rule" },
  { key: "zones", label: "Zones", note: "A vehicle enters or leaves a zone" },
  { key: "offline", label: "Tracker offline", note: "A tracker stops reporting" },
  { key: "loads", label: "Loads", note: "Late, no location, arrived, delivered" }
];

/** Reads saved choices; anything missing or damaged falls back to the defaults. */
export function parsePrefs(raw: string | null | undefined): PushPrefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    type Flag = "enabled" | "speeding" | "zones" | "offline" | "loads" | "quiet";
    const flag = (key: Flag) => (typeof v[key] === "boolean" ? (v[key] as boolean) : DEFAULT_PREFS[key]);
    const time = (key: "quietStart" | "quietEnd") => (typeof v[key] === "number" && Number.isFinite(v[key]) ? wrapMinutes(v[key] as number) : DEFAULT_PREFS[key]);
    return { enabled: flag("enabled"), speeding: flag("speeding"), zones: flag("zones"), offline: flag("offline"), loads: flag("loads"), quiet: flag("quiet"), quietStart: time("quietStart"), quietEnd: time("quietEnd") };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** What the server stores for this phone (POST /api/v1/push/devices). */
export function registrationBody(token: string, platform: "ios" | "android", prefs: PushPrefs, timeZone: string | null = null) {
  // Quiet hours are applied by the server, which needs the phone's time zone to know when "10 PM" is.
  const quiet = prefs.quiet && timeZone !== null && prefs.quietStart !== prefs.quietEnd;
  return {
    token,
    platform,
    speeding: prefs.speeding,
    zones: prefs.zones,
    offline: prefs.offline,
    maintenance: false,
    loads: prefs.loads,
    quietStart: quiet ? prefs.quietStart : null,
    quietEnd: quiet ? prefs.quietEnd : null,
    timeZone: quiet ? timeZone : null
  };
}

/** Where a tapped notification leads. Every alert notification opens the Alerts tab. */
export function routeForNotification(data: unknown): "/(tabs)/alerts" | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  return d.alertId !== undefined || typeof d.type === "string" ? "/(tabs)/alerts" : null;
}

/** Why notifications could not be turned on, in words for the person. */
export type PushProblem = "simulator" | "denied" | "no_token" | "server";
export const PROBLEM_TEXT: Record<PushProblem, string> = {
  simulator: "Notifications need a real phone. They can't be tested in a simulator.",
  denied: "Notifications are turned off for RIO GPS in the phone's Settings. Turn them on there, then try again.",
  no_token: "This phone could not be registered for notifications. Check the connection and try again.",
  server: "The server could not save this phone. Try again in a moment."
};
