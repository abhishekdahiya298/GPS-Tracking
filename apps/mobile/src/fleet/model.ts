/**
 * Fleet data as the server sends it (GET /api/v1/locations/current) and the pure logic the
 * screens share: status, search, filters, sorting and wording. No React Native imports.
 *
 * fleetState and its colours are a copy of the web app's src/lib/fleet-status.ts so both
 * apps always agree on what "Moving", "Idling", "Stopped" and "Offline" mean.
 */
export interface LocationPoint {
  latitude: number;
  longitude: number;
  speedKph: number | null;
  headingDeg: number | null;
  altitudeM: number | null;
  ignition: boolean | null;
  motion: boolean | null;
  recordedAt: string;
  receivedAt: string;
}

export interface FleetDevice {
  deviceId: string;
  model: string | null;
  name: string | null;
  deviceStatus: string;
  vehicle: { id: string; name: string; licensePlate: string | null; type: string } | null;
  connectivity: "online" | "offline" | "never_seen";
  lastSeenAt: string | null;
  location: LocationPoint | null;
}

export interface CurrentLocationsResponse {
  generatedAt: string;
  offlineThresholdSeconds: number;
  devices: FleetDevice[];
}

export type FleetState = "moving" | "idle" | "stopped" | "offline" | "never_seen";
export const MOVING_KPH = 5;

export function fleetState(d: Pick<FleetDevice, "connectivity" | "location">): FleetState {
  if (d.connectivity === "never_seen" || !d.location) return d.connectivity === "offline" ? "offline" : "never_seen";
  if (d.connectivity !== "online") return "offline";
  if ((d.location.speedKph ?? 0) >= MOVING_KPH) return "moving";
  return d.location.ignition === true ? "idle" : "stopped";
}

export const STATE_META: Record<FleetState, { label: string; color: string; soft: string }> = {
  moving: { label: "Moving", color: "#15803d", soft: "#e9f7ee" },
  idle: { label: "Idling", color: "#b45309", soft: "#fff5e1" },
  stopped: { label: "Stopped", color: "#0369a1", soft: "#e8f4fb" },
  offline: { label: "Offline", color: "#6b7280", soft: "#f3f4f6" },
  never_seen: { label: "No data yet", color: "#6b7280", soft: "#f3f4f6" }
};

/** The four filters on the list. Trackers that never reported are counted with Offline. */
export type FleetFilter = "all" | "moving" | "idle" | "stopped" | "offline";
export const FILTERS: Array<{ key: FleetFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "moving", label: "Moving" },
  { key: "idle", label: "Idling" },
  { key: "stopped", label: "Stopped" },
  { key: "offline", label: "Offline" }
];

const filterOf = (s: FleetState): Exclude<FleetFilter, "all"> => (s === "never_seen" ? "offline" : s);

export function displayName(d: FleetDevice): string {
  return d.vehicle?.name || d.name || d.model || "Unnamed tracker";
}

export function countByFilter(devices: FleetDevice[]): Record<FleetFilter, number> {
  const counts: Record<FleetFilter, number> = { all: devices.length, moving: 0, idle: 0, stopped: 0, offline: 0 };
  for (const d of devices) counts[filterOf(fleetState(d))]++;
  return counts;
}

const ORDER: Record<FleetState, number> = { moving: 0, idle: 1, stopped: 2, offline: 3, never_seen: 4 };

/** Search matches the vehicle name, plate, tracker name or model. Active vehicles come first, then A to Z. */
export function selectDevices(devices: FleetDevice[], filter: FleetFilter, search: string): FleetDevice[] {
  const q = search.trim().toLowerCase();
  return devices
    .filter((d) => filter === "all" || filterOf(fleetState(d)) === filter)
    .filter((d) => !q || [d.vehicle?.name, d.vehicle?.licensePlate, d.name, d.model].some((v) => v?.toLowerCase().includes(q)))
    .sort((a, b) => ORDER[fleetState(a)] - ORDER[fleetState(b)] || displayName(a).localeCompare(displayName(b), undefined, { numeric: true }));
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". Future times (clock drift) read as "just now". */
export function timeAgo(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "never";
  const seconds = Math.floor((now - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return "unknown";
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export function compassPoint(headingDeg: number | null): string | null {
  if (headingDeg === null || !Number.isFinite(headingDeg)) return null;
  return POINTS[Math.round((((headingDeg % 360) + 360) % 360) / 45) % 8] ?? null;
}

/** One line under the name: what the vehicle is doing and how fresh that is. */
export function statusLine(d: FleetDevice, fmtSpeed: (kph: number | null) => string, now: number = Date.now()): string {
  const state = fleetState(d);
  if (state === "never_seen") return "Waiting for the first report";
  if (state === "offline") return `Last seen ${timeAgo(d.lastSeenAt, now)}`;
  const fresh = timeAgo(d.location?.recordedAt ?? d.lastSeenAt, now);
  if (state === "moving") {
    const point = compassPoint(d.location?.headingDeg ?? null);
    return `${fmtSpeed(d.location?.speedKph ?? null)}${point ? ` ${point}` : ""} · ${fresh}`;
  }
  return `${state === "idle" ? "Engine on" : "Parked"} · ${fresh}`;
}
