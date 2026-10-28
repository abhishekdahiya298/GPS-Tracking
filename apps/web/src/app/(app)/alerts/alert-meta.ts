import type { Units } from "@rio-gps/core/units";
import type { StatusTone } from "@/components/app/status-badge";
import type { AlertEventDto } from "@/lib/alerts";

export const TYPE_LABEL: Record<string, string> = {
  geofence_enter: "Enters zone",
  geofence_exit: "Leaves zone",
  speeding: "Speeding",
  ignition_on: "Ignition on",
  ignition_off: "Ignition off",
  device_offline: "Device offline",
  load_late: "Load late",
  load_no_signal: "Load: no location",
  load_paused: "Load: driver paused",
  load_arrived: "Load arrived",
  load_delivered: "Load delivered"
};

/** Severity is presentational: shown as text + colour, never colour alone. */
export const SEVERITY: Record<string, { tone: StatusTone; label: string }> = {
  speeding: { tone: "danger", label: "High" },
  device_offline: { tone: "warning", label: "Medium" },
  geofence_enter: { tone: "info", label: "Info" },
  geofence_exit: { tone: "info", label: "Info" },
  ignition_on: { tone: "neutral", label: "Low" },
  ignition_off: { tone: "neutral", label: "Low" },
  load_late: { tone: "danger", label: "High" },
  load_no_signal: { tone: "warning", label: "Medium" },
  load_paused: { tone: "warning", label: "Medium" },
  load_arrived: { tone: "info", label: "Info" },
  load_delivered: { tone: "info", label: "Info" }
};

export function describeAlert(e: AlertEventDto, u: Units): string {
  const d = e.details ?? {};
  const load = typeof d.reference === "string" ? `Load ${d.reference}` : null;
  const who = load ?? e.vehicleName ?? "A device";
  switch (e.type) {
    case "load_late":
      return `${who} is running about ${String(d.lateByMinutes)} min late for ${String(d.target ?? "its stop")}`;
    case "load_no_signal":
      return `${who}: no location for ${String(d.minutes ?? 30)} min`;
    case "load_paused":
      return `${who}: driver paused location sharing`;
    case "load_arrived":
      return `${who} arrived at ${String(d.stop ?? "a stop")}`;
    case "load_delivered":
      return `${who} was delivered`;
    case "geofence_enter":
      return `${who} entered ${String(d.geofence ?? "a zone")}`;
    case "geofence_exit":
      return `${who} left ${String(d.geofence ?? "a zone")}`;
    case "speeding":
      return `${who} at ${u.fmtSpeed(Number(d.speedKph))} (limit ${u.fmtSpeed(Number(d.limitKph))})`;
    case "ignition_on":
      return `${who}: ignition on`;
    case "ignition_off":
      return `${who}: ignition off`;
    case "device_offline":
      return `${who} offline (no data for ${String(d.offlineMinutes)} min)`;
    default:
      return `${who}: ${e.ruleName}`;
  }
}

/** Map deep link: the vehicle's track from 15 min before to 15 min after the alert. */
export function alertMapHref(e: AlertEventDto): string | null {
  if (typeof e.details?.loadId === "string") return `/loads/${e.details.loadId}`;
  if (!e.deviceId) return null;
  const t = Date.parse(e.occurredAt);
  return `/map?${new URLSearchParams({ device: e.deviceId, from: new Date(t - 15 * 60_000).toISOString(), to: new Date(t + 15 * 60_000).toISOString() })}`;
}
