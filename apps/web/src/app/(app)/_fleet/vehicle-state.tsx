import { StatusBadge } from "@/components/app/status-badge";
import type { VehicleState } from "@/lib/fleet-list";

export const VEHICLE_STATE_META: Record<VehicleState, { label: string; tone: "success" | "warning" | "neutral" | "info" }> = {
  moving: { label: "Moving", tone: "success" },
  idle: { label: "Idle", tone: "warning" },
  offline: { label: "Offline", tone: "neutral" },
  never_seen: { label: "No data yet", tone: "neutral" },
  inactive: { label: "Tracker off", tone: "neutral" },
  no_device: { label: "No device", tone: "info" }
};

export function VehicleStateBadge({ state }: { state: VehicleState }) {
  const m = VEHICLE_STATE_META[state];
  return <StatusBadge tone={m.tone} label={m.label} pulse={state === "moving"} />;
}
