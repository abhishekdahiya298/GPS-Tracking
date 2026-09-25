/**
 * Presentation state of a vehicle/device, shared by dashboard, map and lists.
 * Pure (no server imports) so client components can use it.
 */
export type FleetState = "moving" | "idle" | "offline" | "never_seen";

export const MOVING_KPH = 5;

export function fleetState(d: { connectivity: string; location: { speedKph: number | null; ignition: boolean | null } | null }): FleetState {
  if (d.connectivity === "never_seen" || !d.location) return d.connectivity === "offline" ? "offline" : "never_seen";
  if (d.connectivity !== "online") return "offline";
  return (d.location.speedKph ?? 0) >= MOVING_KPH ? "moving" : "idle";
}

export const FLEET_STATE_META: Record<FleetState, { label: string; tone: "success" | "warning" | "neutral"; color: string }> = {
  moving: { label: "Moving", tone: "success", color: "#15803d" },
  idle: { label: "Idle", tone: "warning", color: "#d97706" },
  offline: { label: "Offline", tone: "neutral", color: "#6b7280" },
  never_seen: { label: "No data yet", tone: "neutral", color: "#9ca3af" }
};
