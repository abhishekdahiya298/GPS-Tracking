import type { StatusTone } from "@/components/app/status-badge";

/** Display metadata per alert type (label + severity tone). */
export const ALERT_META: Record<string, { label: string; short: string; tone: StatusTone; severity: "high" | "medium" | "info" }> = {
  speeding: { label: "Speeding", short: "is speeding", tone: "danger", severity: "high" },
  device_offline: { label: "Device offline", short: "went offline", tone: "warning", severity: "medium" },
  geofence_enter: { label: "Entered zone", short: "entered a zone", tone: "info", severity: "info" },
  geofence_exit: { label: "Left zone", short: "left a zone", tone: "info", severity: "info" },
  ignition_on: { label: "Ignition on", short: "ignition on", tone: "neutral", severity: "info" },
  ignition_off: { label: "Ignition off", short: "ignition off", tone: "neutral", severity: "info" },
  load_late: { label: "Load late", short: "is running late", tone: "danger", severity: "high" },
  load_no_signal: { label: "Load: no location", short: "has no recent location", tone: "warning", severity: "medium" },
  load_paused: { label: "Load: driver paused", short: "driver paused sharing", tone: "warning", severity: "medium" },
  load_arrived: { label: "Load arrived", short: "arrived", tone: "info", severity: "info" },
  load_delivered: { label: "Load delivered", short: "was delivered", tone: "info", severity: "info" }
};

export function alertMeta(type: string) {
  return ALERT_META[type] ?? { label: type.replace(/_/g, " "), short: type.replace(/_/g, " "), tone: "neutral" as StatusTone, severity: "info" as const };
}
