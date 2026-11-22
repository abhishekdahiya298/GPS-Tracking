import { LOAD_ALERT_TYPES, type AlertEventType } from "@rio-gps/core";

/** Alert categories shown as filter tiles on the Alerts page. Each groups one or more event types. */
export const ALERT_KINDS = ["speeding", "zone", "offline", "ignition", "load"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
export const KIND_TYPES: Record<AlertKind, readonly AlertEventType[]> = {
  speeding: ["speeding"],
  zone: ["geofence_enter", "geofence_exit"],
  offline: ["device_offline"],
  ignition: ["ignition_on", "ignition_off"],
  load: LOAD_ALERT_TYPES
};
export function kindOf(type: string): AlertKind | null {
  for (const k of ALERT_KINDS) if ((KIND_TYPES[k] as readonly string[]).includes(type)) return k;
  return null;
}
