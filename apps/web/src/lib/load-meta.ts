import type { LoadStatus } from "@rio-gps/core/loads";
import type { StatusTone } from "@/components/app/status-badge";

/** Labels for a load's status (broker, driver and shipper pages). Client-safe. */
export const LOAD_STATUS_META: Record<LoadStatus, { label: string; tone: StatusTone; shipperLabel: string }> = {
  invited: { label: "Waiting for driver", tone: "neutral", shipperLabel: "Scheduled" },
  tracking: { label: "Heading to pickup", tone: "info", shipperLabel: "Heading to pickup" },
  at_pickup: { label: "At pickup", tone: "primary", shipperLabel: "Loading at pickup" },
  in_transit: { label: "In transit", tone: "success", shipperLabel: "In transit" },
  at_delivery: { label: "At delivery", tone: "primary", shipperLabel: "Arrived at delivery" },
  delivered: { label: "Delivered", tone: "success", shipperLabel: "Delivered" },
  cancelled: { label: "Cancelled", tone: "neutral", shipperLabel: "Cancelled" },
  declined: { label: "Driver declined", tone: "danger", shipperLabel: "Not available" }
};

export const LOAD_EVENT_LABEL: Record<string, string> = {
  created: "Load created",
  invite_sent: "Invite texted to driver",
  accepted: "Driver accepted and started sharing",
  declined: "Driver declined",
  sharing_stopped: "Driver paused sharing",
  sharing_resumed: "Driver resumed sharing",
  arrived_pickup: "Arrived at pickup",
  departed_pickup: "Left pickup",
  arrived_delivery: "Arrived at delivery",
  departed_delivery: "Left delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
  updated: "Load details edited"
};

/**
 * Short place for lists and headers: the stop's name, else "City, ST" from an address like
 * "100 Front Street West, Toronto, ON M5J 1E3, Canada" (or "Montréal, QC, Canada").
 */
export function shortPlace(name: string | null, address: string): string {
  if (name) return name;
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 2) return address;
  // "[street,] city, ST postcode, country": the city is third from the end.
  const city = parts[parts.length - 3]!;
  const region = parts[parts.length - 2]!.split(" ")[0]!;
  return region.length <= 3 ? `${city}, ${region}` : city;
}

export function fmtDistanceM(m: number, imperial: boolean): string {
  if (imperial) {
    const mi = m / 1609.344;
    return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi).toLocaleString()} mi`;
  }
  const km = m / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString()} km`;
}

/** What a load is doing right now, for the loads map and its filters. */
export type LoadMotion = "moving" | "stopped" | "paused" | "no_signal" | "waiting";

/** At or above this speed (km/h) a fresh position counts as moving (about 5 mph). */
export const MOVING_KPH = 8;
/** A position older than this is not trusted to say "moving" (the truck may have stopped since). */
const MOVING_FRESH_MS = 10 * 60_000;

export const MOTION_META: Record<LoadMotion, { label: string; color: string; order: number }> = {
  moving: { label: "Moving", color: "#15803d", order: 2 },
  stopped: { label: "Stopped", color: "#0369a1", order: 3 },
  paused: { label: "Driver paused", color: "#b45309", order: 1 },
  no_signal: { label: "No signal", color: "#6b7280", order: 0 },
  waiting: { label: "Waiting for driver", color: "#9ca3af", order: 4 }
};

interface MotionInput {
  status: string;
  sharingStopped: boolean;
  stale: boolean;
  lastPosition: { speedKph: number | null; at: string } | null;
  eta: { late: boolean } | null;
}

export function loadMotion(l: MotionInput, now = Date.now()): LoadMotion {
  if (l.status === "invited") return "waiting";
  if (l.sharingStopped) return "paused";
  if (l.stale || !l.lastPosition) return "no_signal";
  const fresh = now - Date.parse(l.lastPosition.at) <= MOVING_FRESH_MS;
  return fresh && (l.lastPosition.speedKph ?? 0) >= MOVING_KPH ? "moving" : "stopped";
}

/** Late, silent or paused: the loads a dispatcher should look at first. */
export function needsAttention(l: MotionInput): boolean {
  return Boolean(l.eta?.late) || l.stale || l.sharingStopped;
}
