import { isFixStale } from "@rio-gps/core/freshness";

/**
 * Presentation state of a vehicle/device, shared by dashboard, map and lists.
 * Pure (no server imports) so client components can use it.
 */
/**
 * moving: travelling. idle: engine on, standing still. stopped: standing still with the
 * engine off (or no ignition signal). offline: tracker silent past the offline threshold.
 * parked: a trailer whose tracker went silent. A trailer tracker is powered by the tractor,
 * so silence normally means it was unhooked and parked, not that something is wrong.
 */
export type FleetState = "moving" | "idle" | "stopped" | "parked" | "offline" | "never_seen";

/** Vehicle types whose tracker is powered by the towing vehicle (silent = unhooked). */
export function isTowed(type: string | null | undefined) {
  return type === "trailer";
}

export const MOVING_KPH = 5;

export interface FleetStateOptions {
  /** Current time; defaults to Date.now(). */
  nowMs?: number;
  /** Oldest GPS fix that still describes the vehicle now (see @rio-gps/core/freshness). */
  maxFixAgeSeconds?: number;
}

export function fleetState(
  d: {
    connectivity: string;
    location: { speedKph: number | null; ignition: boolean | null; recordedAt?: string } | null;
    vehicle?: { type: string } | null;
  },
  opts: FleetStateOptions = {}
): FleetState {
  if (d.connectivity === "never_seen" || !d.location) return d.connectivity === "offline" ? "offline" : "never_seen";
  if (d.connectivity !== "online") return isTowed(d.vehicle?.type) ? "parked" : "offline";
  // Online, but the newest position is old (backlog upload or no GNSS fix): its speed and
  // ignition describe the past, so never claim Moving or Idling from it.
  if (d.location.recordedAt && isFixStale(d.location.recordedAt, opts.nowMs ?? Date.now(), opts.maxFixAgeSeconds)) return "stopped";
  if ((d.location.speedKph ?? 0) >= MOVING_KPH) return "moving";
  return d.location.ignition === true ? "idle" : "stopped";
}

export const FLEET_STATE_META: Record<FleetState, { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" | "parked"; color: string }> = {
  moving: { label: "Moving", tone: "success", color: "#136c35" },
  idle: { label: "Idling", tone: "warning", color: "#a3470a" },
  stopped: { label: "Stopped", tone: "danger", color: "#ad1f1f" },
  parked: { label: "Parked (unhooked)", tone: "parked", color: "#6526d1" },
  offline: { label: "Offline", tone: "neutral", color: "#6b7280" },
  never_seen: { label: "No data yet", tone: "neutral", color: "#9ca3af" }
};
