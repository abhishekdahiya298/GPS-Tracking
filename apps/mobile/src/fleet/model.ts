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

/** parked: a trailer whose tracker went silent. It is powered by the tractor, so silence means unhooked. */
export type FleetState = "moving" | "idle" | "stopped" | "parked" | "offline" | "never_seen";
export const MOVING_KPH = 5;

export function fleetState(d: Pick<FleetDevice, "connectivity" | "location"> & { vehicle?: FleetDevice["vehicle"] }): FleetState {
  if (d.connectivity === "never_seen" || !d.location) return d.connectivity === "offline" ? "offline" : "never_seen";
  if (d.connectivity !== "online") return d.vehicle?.type === "trailer" ? "parked" : "offline";
  if ((d.location.speedKph ?? 0) >= MOVING_KPH) return "moving";
  return d.location.ignition === true ? "idle" : "stopped";
}

export const STATE_META: Record<FleetState, { label: string; color: string; soft: string }> = {
  moving: { label: "Moving", color: "#0f5c2c", soft: "#b4e0c2" },
  idle: { label: "Idling", color: "#8f3d06", soft: "#fbcd9b" },
  stopped: { label: "Stopped", color: "#9c1818", soft: "#f4bcbc" },
  parked: { label: "Parked (unhooked)", color: "#5a1fc0", soft: "#d0bbf9" },
  offline: { label: "Offline", color: "#414b59", soft: "#c6cdd8" },
  never_seen: { label: "No data yet", color: "#414b59", soft: "#c6cdd8" }
};

/** The four filters on the list. Trackers that never reported are counted with Offline; parked trailers with Stopped. */
export type FleetFilter = "all" | "moving" | "idle" | "stopped" | "offline";
export const FILTERS: Array<{ key: FleetFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "moving", label: "Moving" },
  { key: "idle", label: "Idling" },
  { key: "stopped", label: "Stopped" },
  { key: "offline", label: "Offline" }
];

const filterOf = (s: FleetState): Exclude<FleetFilter, "all"> => (s === "never_seen" ? "offline" : s === "parked" ? "stopped" : s);

export function displayName(d: FleetDevice): string {
  return d.vehicle?.name || d.name || d.model || "Unnamed tracker";
}

export function countByFilter(devices: FleetDevice[]): Record<FleetFilter, number> {
  const counts: Record<FleetFilter, number> = { all: devices.length, moving: 0, idle: 0, stopped: 0, offline: 0 };
  for (const d of devices) counts[filterOf(fleetState(d))]++;
  return counts;
}

const ORDER: Record<FleetState, number> = { moving: 0, idle: 1, stopped: 2, parked: 3, offline: 4, never_seen: 5 };

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
  if (state === "parked") return `Unhooked · last seen ${timeAgo(d.lastSeenAt, now)}`;
  const fresh = timeAgo(d.location?.recordedAt ?? d.lastSeenAt, now);
  if (state === "moving") {
    const point = compassPoint(d.location?.headingDeg ?? null);
    return `${fmtSpeed(d.location?.speedKph ?? null)}${point ? ` ${point}` : ""} · ${fresh}`;
  }
  return `${state === "idle" ? "Engine on" : "Parked"} · ${fresh}`;
}

/** "43.5132, -79.8821": where a vehicle is when no street address is known. Never a guessed address. */
export function coordsText(d: FleetDevice): string | null {
  const l = d.location;
  if (!l || !Number.isFinite(l.latitude) || !Number.isFinite(l.longitude)) return null;
  return `${l.latitude.toFixed(4)}, ${l.longitude.toFixed(4)}`;
}

/** How long the vehicle has been in its state, or how fresh the last report is: "Updated 30 sec ago", "Last seen 6 h ago". */
export function freshnessLine(d: FleetDevice, now: number = Date.now()): string {
  const state = fleetState(d);
  if (state === "never_seen") return "Waiting for the first report";
  if (state === "offline" || state === "parked") return `Last seen ${timeAgo(d.lastSeenAt, now)}`;
  return `Updated ${timeAgo(d.location?.recordedAt ?? d.lastSeenAt, now)}`;
}

/**
 * The small facts under a vehicle card, only from data the tracker really sent:
 * ignition on/off, the way it is heading while moving, and Trailer for trailers.
 * Battery voltage and GPS signal appear here once the server stores them.
 */
export type VehicleFact = { key: "ignition" | "heading" | "trailer" | "plate"; label: string; tone: "good" | "bad" | "neutral"; headingDeg?: number };
export function vehicleFacts(d: FleetDevice): VehicleFact[] {
  const out: VehicleFact[] = [];
  const state = fleetState(d);
  if (d.vehicle?.type === "trailer") out.push({ key: "trailer", label: "Trailer", tone: "neutral" });
  else if (d.location?.ignition === true || d.location?.ignition === false) out.push({ key: "ignition", label: d.location.ignition ? "Ignition on" : "Ignition off", tone: d.location.ignition ? "good" : "bad" });
  const point = compassPoint(d.location?.headingDeg ?? null);
  if (state === "moving" && point && d.location?.headingDeg !== null && d.location?.headingDeg !== undefined) out.push({ key: "heading", label: `${point} ${Math.round(((d.location.headingDeg % 360) + 360) % 360)}°`, tone: "neutral", headingDeg: d.location.headingDeg });
  if (d.vehicle?.licensePlate) out.push({ key: "plate", label: d.vehicle.licensePlate, tone: "neutral" });
  return out;
}

/** "north-east" for 45°. Used in sentences such as "Driving north-east". */
const WORDS: Record<string, string> = { N: "north", NE: "north-east", E: "east", SE: "south-east", S: "south", SW: "south-west", W: "west", NW: "north-west" };

/**
 * The four tiles on a vehicle sheet, each from a real reading: ignition and motion as the tracker
 * reported them ("—" when it sent none), how old the GPS fix is, and whether the tracker is reporting.
 */
export function sheetFacts(d: FleetDevice, now: number = Date.now()): { ignition: string; motion: string; gps: { value: string; fresh: boolean }; tracker: { value: string; online: boolean } } {
  const l = d.location;
  const fixAge = l ? (now - new Date(l.recordedAt).getTime()) / 1000 : Infinity;
  const fresh = Number.isFinite(fixAge) && fixAge < 120;
  return {
    ignition: l?.ignition === true ? "On" : l?.ignition === false ? "Off" : "—",
    motion: fleetState(d) === "moving" ? "Moving" : l?.motion === true ? "Moving" : l?.motion === false ? "Still" : "—",
    gps: { value: !l ? "No fix" : fresh ? "Live" : timeAgo(l.recordedAt, now).replace(" ago", " old"), fresh },
    tracker: { value: d.connectivity === "online" ? "Online" : d.connectivity === "offline" ? "Offline" : "Never seen", online: d.connectivity === "online" }
  };
}

/** The right side of the speed band: what the vehicle is doing, and the detail under it. */
export function sheetHeadline(d: FleetDevice, now: number = Date.now()): { title: string; detail: string } {
  const state = fleetState(d);
  const point = compassPoint(d.location?.headingDeg ?? null);
  if (state === "moving") return { title: point ? `Driving ${WORDS[point]}` : "Driving", detail: d.location?.headingDeg != null ? `Heading ${Math.round(((d.location.headingDeg % 360) + 360) % 360)}°` : freshnessLine(d, now) };
  if (state === "idle") return { title: "Engine on, standing", detail: freshnessLine(d, now) };
  if (state === "stopped") return { title: "Stopped", detail: freshnessLine(d, now) };
  if (state === "parked") return { title: "Parked, unhooked", detail: freshnessLine(d, now) };
  return { title: STATE_META[state].label, detail: freshnessLine(d, now) };
}

/** The vehicle type as people read it. The type is chosen per vehicle on the website. */
const TYPE_LABEL: Record<string, string> = {
  truck: "Truck with trailer", semi: "Tractor only", trailer: "Trailer", box_truck: "Box truck", tanker: "Tanker", dump_truck: "Dump truck",
  mixer: "Mixer", garbage_truck: "Garbage truck", van: "Van", pickup: "Pickup", car: "Car", motorcycle: "Motorcycle", bus: "Bus",
  school_bus: "School bus", excavator: "Excavator", tractor: "Farm tractor", equipment: "Equipment", other: "Other"
};
export function typeLabel(type: string | null | undefined): string | null {
  if (!type) return null;
  return TYPE_LABEL[type] ?? type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, " ");
}
