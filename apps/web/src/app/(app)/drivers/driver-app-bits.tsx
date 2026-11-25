"use client";
import { BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, MapPinOff, Smartphone, SmartphoneNfc, WifiOff } from "lucide-react";
import type { DriverAppState } from "@/lib/driver-app";
import { cn } from "@/lib/cn";

/** How each driver app state looks, the same on Drivers, the live map and the dashboard. */
export const APP_STATE: Record<DriverAppState, { label: string; color: string; Icon: typeof Smartphone; hint: string }> = {
  sharing: { label: "Sharing", color: "#15803d", Icon: SmartphoneNfc, hint: "The app is signed in and sending location." },
  stale: { label: "Not heard from", color: "#b45309", Icon: WifiOff, hint: "Signed in, but the phone hasn't reported for 30 minutes (no signal, phone off or app closed)." },
  location_off: { label: "Location off", color: "#b91c1c", Icon: MapPinOff, hint: "Signed in, but location is turned off on the phone." },
  signed_out: { label: "Signed out", color: "#475569", Icon: Smartphone, hint: "The driver signed out of the app." },
  no_app: { label: "No app yet", color: "#c2410c", Icon: Smartphone, hint: "Send the driver an invite to the RIO GPS app." }
};

export function AppStateChip({ state, className }: { state: DriverAppState; className?: string }) {
  const s = APP_STATE[state];
  return (
    <span
      title={s.hint}
      className={cn("inline-flex h-6 w-fit items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11.5px] font-semibold", className)}
      style={{ color: s.color, background: `color-mix(in srgb, ${s.color} 11%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${s.color} 25%, transparent)` }}
    >
      <s.Icon className="size-3.5" aria-hidden="true" />
      {s.label}
    </span>
  );
}

/** Phone battery, like Life360: red under 20%, amber under 50%. */
export function Battery({ pct, charging, className }: { pct: number | null; charging: boolean | null; className?: string }) {
  if (pct == null) return null;
  const Icon = charging ? BatteryCharging : pct < 20 ? BatteryLow : pct < 60 ? BatteryMedium : BatteryFull;
  const color = charging ? "#15803d" : pct < 20 ? "#b91c1c" : pct < 50 ? "#b45309" : "#15803d";
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[11.5px] font-semibold tabular-nums", className)} style={{ color }} title={charging ? "Phone battery, charging" : "Phone battery"}>
      <Icon className="size-4" aria-hidden="true" />
      {pct}%
    </span>
  );
}
