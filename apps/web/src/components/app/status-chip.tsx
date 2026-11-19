import { CircleDashed, CircleParking, CircleStop, Navigation, PowerOff, Radio, Timer, Unplug, WifiOff, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * One status vocabulary for the whole product: the same colour, icon and words on the
 * map, dashboard, vehicles, drivers and devices (and the same colours as the phone app).
 */
export const STATUS_THEME = {
  moving: { label: "Moving", color: "#15803d", icon: Navigation },
  idle: { label: "Idling", color: "#c2410c", icon: Timer },
  stopped: { label: "Stopped", color: "#b91c1c", icon: CircleStop },
  parked: { label: "Parked (unhooked)", color: "#6d28d9", icon: CircleParking },
  offline: { label: "Offline", color: "#64748b", icon: WifiOff },
  never_seen: { label: "No data yet", color: "#64748b", icon: CircleDashed },
  inactive: { label: "Tracker off", color: "#64748b", icon: PowerOff },
  no_device: { label: "No device", color: "#0369a1", icon: Unplug },
  online: { label: "Online", color: "#15803d", icon: Radio },
  retired: { label: "Retired", color: "#475569", icon: PowerOff }
} as const satisfies Record<string, { label: string; color: string; icon: LucideIcon }>;
export type StatusKey = keyof typeof STATUS_THEME;

/** Status pill: icon + words in the status colour on a light tint (never colour alone). */
export function StatusChip({ status, label, className }: { status: StatusKey; label?: string; className?: string }) {
  const t = STATUS_THEME[status];
  const Icon = t.icon;
  return (
    <span
      className={cn("inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold", className)}
      style={{ color: t.color, background: `color-mix(in srgb, ${t.color} 12%, var(--color-background))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${t.color} 26%, transparent)` }}
    >
      <Icon className={cn("size-3.5", status === "moving" && "motion-safe:animate-pulse")} aria-hidden="true" />
      {label ?? t.label}
    </span>
  );
}
