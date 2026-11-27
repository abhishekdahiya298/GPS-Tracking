import { DEFAULT_OFFLINE_SECONDS, isFixStale, isSilent, maxFixAgeFor } from "@rio-gps/core/freshness";

/**
 * Presentation state of a vehicle/device, shared by dashboard, map and lists.
 * Pure (no server imports) so client components can use it.
 */
/**
 * moving: travelling. idle: engine on, standing still. stopped: standing still with the
 * engine off (or no ignition signal). offline ("No signal" to users): tracker silent past the
 * allowance for its state (4 h 30 min parked, 15 min when it was driving).
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
  /** Silence allowed for a parked tracker (server offlineThresholdSeconds). */
  offlineSeconds?: number;
}

export function fleetState(
  d: {
    connectivity: string;
    lastSeenAt?: string | null;
    location: { speedKph: number | null; ignition: boolean | null; recordedAt?: string } | null;
    vehicle?: { type: string } | null;
  },
  opts: FleetStateOptions = {}
): FleetState {
  const nowMs = opts.nowMs ?? Date.now();
  const offlineSeconds = opts.offlineSeconds ?? DEFAULT_OFFLINE_SECONDS;
  if (d.connectivity === "never_seen" || !d.location) return d.connectivity === "offline" ? "offline" : "never_seen";
  // Silent: past the parked allowance, or driving at the last report and silent 15 min (dead zone).
  if (d.connectivity !== "online" || isSilent(d.lastSeenAt, d.location, nowMs, offlineSeconds)) return isTowed(d.vehicle?.type) ? "parked" : "offline";
  // Online, but the newest position is old (backlog upload or no GNSS fix): its speed and
  // ignition describe the past, so never claim Moving or Idling from it. A parked fix stays
  // true until the next 4-hourly report is due.
  if (d.location.recordedAt && isFixStale(d.location.recordedAt, nowMs, maxFixAgeFor(d.location, offlineSeconds))) return "stopped";
  if ((d.location.speedKph ?? 0) >= MOVING_KPH) return "moving";
  return d.location.ignition === true ? "idle" : "stopped";
}

export const FLEET_STATE_META: Record<FleetState, { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" | "parked"; color: string }> = {
  moving: { label: "Moving", tone: "success", color: "#0f5c2c" },
  idle: { label: "Idling", tone: "warning", color: "#8f3d06" },
  stopped: { label: "Stopped", tone: "danger", color: "#9c1818" },
  parked: { label: "Parked (unhooked)", tone: "parked", color: "#5a1fc0" },
  offline: { label: "No signal", tone: "neutral", color: "#6b7280" },
  never_seen: { label: "No data yet", tone: "neutral", color: "#9ca3af" }
};
