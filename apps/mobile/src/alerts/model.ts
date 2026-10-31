/**
 * Alerts as the server sends them (GET /api/v1/alerts) and the pure logic the screen uses.
 * Labels match the web app's src/lib/alert-meta.ts.
 */
export interface AlertEvent {
  id: number;
  type: string;
  ruleName: string;
  deviceId: string | null;
  vehicleId: string | null;
  vehicleName: string | null;
  occurredAt: string;
  latitude: number | null;
  longitude: number | null;
  details: Record<string, unknown> | null;
  acknowledgedAt: string | null;
}

export interface AlertsResponse {
  events: AlertEvent[];
  unacknowledged: number;
}

export type AlertIcon = "speedometer-outline" | "cloud-offline-outline" | "enter-outline" | "exit-outline" | "key-outline" | "notifications-outline";

const META: Record<string, { label: string; verb: string; color: string; soft: string; icon: AlertIcon }> = {
  speeding: { label: "Speeding", verb: "is speeding", color: "#c42b2b", soft: "#fdecec", icon: "speedometer-outline" },
  device_offline: { label: "Device offline", verb: "went offline", color: "#b45309", soft: "#fff5e1", icon: "cloud-offline-outline" },
  geofence_enter: { label: "Entered zone", verb: "entered a zone", color: "#0369a1", soft: "#e8f4fb", icon: "enter-outline" },
  geofence_exit: { label: "Left zone", verb: "left a zone", color: "#0369a1", soft: "#e8f4fb", icon: "exit-outline" },
  ignition_on: { label: "Ignition on", verb: "ignition on", color: "#5b6472", soft: "#f3f4f6", icon: "key-outline" },
  ignition_off: { label: "Ignition off", verb: "ignition off", color: "#5b6472", soft: "#f3f4f6", icon: "key-outline" }
};

export function alertMeta(type: string) {
  const words = type.replace(/_/g, " ");
  return META[type] ?? { label: words.charAt(0).toUpperCase() + words.slice(1), verb: words, color: "#5b6472", soft: "#f3f4f6", icon: "notifications-outline" as AlertIcon };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The headline: who and what, e.g. "Truck 1 is speeding" or "Truck 1 entered Yard". */
export function alertTitle(e: AlertEvent): string {
  const who = e.vehicleName ?? "A vehicle";
  const zone = text(e.details?.geofence);
  if (e.type === "geofence_enter") return `${who} entered ${zone ?? "a zone"}`;
  if (e.type === "geofence_exit") return `${who} left ${zone ?? "a zone"}`;
  return `${who} ${alertMeta(e.type).verb}`;
}

/** The extra facts for this alert type, or null when there are none. */
export function alertDetail(e: AlertEvent, fmtSpeed: (kph: number | null) => string): string | null {
  if (e.type === "speeding") {
    const speed = num(e.details?.speedKph);
    const limit = num(e.details?.limitKph);
    if (speed === null) return null;
    return limit === null ? fmtSpeed(speed) : `${fmtSpeed(speed)}, limit ${fmtSpeed(limit)}`;
  }
  if (e.type === "device_offline") {
    const minutes = num(e.details?.offlineMinutes);
    if (minutes === null) return null;
    const rounded = Math.round(minutes);
    return rounded < 60 ? `No signal for ${rounded} min` : `No signal for ${Math.round(rounded / 60)} h`;
  }
  return null;
}

/** Adds a page to the list: no duplicates, newest (highest id) first. */
export function mergeEvents(current: AlertEvent[], incoming: AlertEvent[]): AlertEvent[] {
  const byId = new Map<number, AlertEvent>();
  for (const e of current) byId.set(e.id, e);
  for (const e of incoming) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => b.id - a.id);
}

/** What the list looks like right after marking alerts as read, before the server answers again. */
export function markRead(events: AlertEvent[], ids: number[] | "all", at: string, unreadOnly: boolean): AlertEvent[] {
  const hit = (e: AlertEvent) => !e.acknowledgedAt && (ids === "all" || ids.includes(e.id));
  return unreadOnly ? events.filter((e) => !hit(e)) : events.map((e) => (hit(e) ? { ...e, acknowledgedAt: at } : e));
}

export function badgeText(unread: number): string | undefined {
  if (unread <= 0) return undefined;
  return unread > 99 ? "99+" : String(unread);
}
