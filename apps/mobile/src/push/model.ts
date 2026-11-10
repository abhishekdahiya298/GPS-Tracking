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
}

export const DEFAULT_PREFS: PushPrefs = { enabled: false, speeding: true, zones: true, offline: true, loads: true };

export const PUSH_KINDS: Array<{ key: Exclude<keyof PushPrefs, "enabled">; label: string; note: string }> = [
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
    const flag = (key: keyof PushPrefs) => (typeof v[key] === "boolean" ? (v[key] as boolean) : DEFAULT_PREFS[key]);
    return { enabled: flag("enabled"), speeding: flag("speeding"), zones: flag("zones"), offline: flag("offline"), loads: flag("loads") };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** What the server stores for this phone (POST /api/v1/push/devices). */
export function registrationBody(token: string, platform: "ios" | "android", prefs: PushPrefs) {
  return { token, platform, speeding: prefs.speeding, zones: prefs.zones, offline: prefs.offline, maintenance: false, loads: prefs.loads };
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
