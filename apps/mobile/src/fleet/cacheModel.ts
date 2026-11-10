/**
 * The last fleet the app showed, kept on the phone so the map and list are not empty while
 * the first answer is on its way (or when there is no connection). Pure text in, data out.
 */
import type { FleetDevice } from "./model";

/** Older than this and the saved fleet is not shown at all. */
export const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function encodeCache(devices: FleetDevice[], now: number): string {
  return JSON.stringify({ v: 1, savedAt: now, devices });
}

/** Returns the saved fleet, or null when there is none, it is damaged, or it is too old. */
export function decodeCache(raw: string | null | undefined, now: number): { devices: FleetDevice[]; savedAt: number } | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { v?: unknown; savedAt?: unknown; devices?: unknown };
    if (v.v !== 1 || typeof v.savedAt !== "number" || !Array.isArray(v.devices)) return null;
    if (now - v.savedAt > CACHE_MAX_AGE_MS || v.savedAt > now + 60_000) return null;
    const devices = (v.devices as FleetDevice[]).filter((d) => d && typeof d.deviceId === "string");
    return devices.length > 0 ? { devices, savedAt: v.savedAt } : null;
  } catch {
    return null;
  }
}
