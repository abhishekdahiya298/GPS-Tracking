import type { VehicleState } from "@/lib/fleet-list";

/** Same colours as the map pins and 3D pictures: green moving, orange idling, red stopped, purple parked, grey silent. */
export const VEHICLE_STATE_META: Record<VehicleState, { label: string; tone: "success" | "warning" | "neutral" | "info"; color: string }> = {
  moving: { label: "Moving", tone: "success", color: "#15803d" },
  idle: { label: "Idling", tone: "warning", color: "#c2410c" },
  stopped: { label: "Stopped", tone: "info", color: "#b91c1c" },
  parked: { label: "Parked (unhooked)", tone: "info", color: "#6d28d9" },
  offline: { label: "Offline", tone: "neutral", color: "#64748b" },
  never_seen: { label: "No data yet", tone: "neutral", color: "#64748b" },
  inactive: { label: "Tracker off", tone: "neutral", color: "#64748b" },
  no_device: { label: "No device", tone: "info", color: "#0369a1" }
};

/** Status pill in the state's own colour (dot + label, so it never relies on colour alone). */
export function VehicleStateBadge({ state }: { state: VehicleState }) {
  const m = VEHICLE_STATE_META[state];
  return (
    <span
      className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold"
      style={{ color: m.color, background: `color-mix(in srgb, ${m.color} 13%, var(--color-background))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${m.color} 28%, transparent)` }}
    >
      <span aria-hidden="true" className={state === "moving" ? "size-1.5 animate-pulse rounded-full bg-current" : "size-1.5 rounded-full bg-current"} />
      {m.label}
    </span>
  );
}
