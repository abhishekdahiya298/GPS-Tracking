/**
 * Presentation state of a vehicle/device, shared by dashboard, map and lists.
 * Pure (no server imports) so client components can use it.
 */
/**
 * moving: travelling. idle: engine on, standing still. stopped: standing still with the
 * engine off (or no ignition signal). offline: tracker silent past the offline threshold.
 */
export type FleetState = "moving" | "idle" | "stopped" | "offline" | "never_seen";

export const MOVING_KPH = 5;

export function fleetState(d: { connectivity: string; location: { speedKph: number | null; ignition: boolean | null } | null }): FleetState {
  if (d.connectivity === "never_seen" || !d.location) return d.connectivity === "offline" ? "offline" : "never_seen";
  if (d.connectivity !== "online") return "offline";
  if ((d.location.speedKph ?? 0) >= MOVING_KPH) return "moving";
  return d.location.ignition === true ? "idle" : "stopped";
}

export const FLEET_STATE_META: Record<FleetState, { label: string; tone: "success" | "warning" | "info" | "neutral"; color: string }> = {
  moving: { label: "Moving", tone: "success", color: "#15803d" },
  idle: { label: "Idling", tone: "warning", color: "#d97706" },
  stopped: { label: "Stopped", tone: "info", color: "#0369a1" },
  offline: { label: "Offline", tone: "neutral", color: "#6b7280" },
  never_seen: { label: "No data yet", tone: "neutral", color: "#9ca3af" }
};
