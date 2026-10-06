import { asVehicleType } from "@/lib/schemas/vehicle";
import { VEHICLE_GLYPHS, WHEEL_Y } from "@/lib/vehicle-glyphs";
import { cn } from "@/lib/cn";

/**
 * The pictogram for a kind of vehicle (same shapes as the map markers).
 * Decorative: always pair it with the vehicle's name or the type label.
 */
export function VehicleTypeIcon({ type, className }: { type: string | null | undefined; className?: string }) {
  const g = VEHICLE_GLYPHS[asVehicleType(type)];
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={cn("size-4 shrink-0", className)}>
      <path d={g.body} fill="currentColor" />
      {g.wheels.map(([x, r]) => (
        <circle key={x} cx={x} cy={WHEEL_Y} r={r} fill="currentColor" stroke="var(--vehicle-icon-gap, var(--color-background))" strokeWidth={1.1} />
      ))}
    </svg>
  );
}
