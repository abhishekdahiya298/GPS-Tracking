import { StatusChip, STATUS_THEME } from "@/components/app/status-chip";
import type { VehicleState } from "@/lib/fleet-list";

/** Vehicle status words and colours: the shared status theme (map, dashboard, lists). */
export const VEHICLE_STATE_META: Record<VehicleState, { label: string; tone: "success" | "warning" | "neutral" | "info"; color: string }> = {
  moving: { label: STATUS_THEME.moving.label, tone: "success", color: STATUS_THEME.moving.color },
  idle: { label: STATUS_THEME.idle.label, tone: "warning", color: STATUS_THEME.idle.color },
  stopped: { label: STATUS_THEME.stopped.label, tone: "info", color: STATUS_THEME.stopped.color },
  parked: { label: STATUS_THEME.parked.label, tone: "info", color: STATUS_THEME.parked.color },
  offline: { label: STATUS_THEME.offline.label, tone: "neutral", color: STATUS_THEME.offline.color },
  never_seen: { label: STATUS_THEME.never_seen.label, tone: "neutral", color: STATUS_THEME.never_seen.color },
  inactive: { label: STATUS_THEME.inactive.label, tone: "neutral", color: STATUS_THEME.inactive.color },
  no_device: { label: STATUS_THEME.no_device.label, tone: "info", color: STATUS_THEME.no_device.color }
};

export function VehicleStateBadge({ state }: { state: VehicleState }) {
  return <StatusChip status={state} />;
}
