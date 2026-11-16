import { VehicleTypeIcon } from "@/components/app/vehicle-type-icon";
import { cn } from "@/lib/cn";

/** What the vehicle is doing; it sets the colour of its 3D picture. */
export type PictureState = "moving" | "idle" | "stopped" | "parked" | "offline";

/** Vehicle types that have a 3D picture (the same files as the phone app). Others show their symbol. */
const PICTURE_OF: Record<string, string> = {
  truck: "truck",
  semi: "semi",
  trailer: "trailer",
  car: "car",
  van: "van",
  pickup: "pickup",
  box_truck: "box_truck",
  tanker: "tanker",
  dump_truck: "dump_truck",
  mixer: "mixer",
  garbage_truck: "garbage_truck",
  bus: "bus",
  school_bus: "school_bus"
};
const STATE_TINT: Record<PictureState, string> = { moving: "#136c35", idle: "#a3470a", stopped: "#ad1f1f", parked: "#6526d1", offline: "#4b5563" };

/**
 * The vehicle picture used on lists and cards, the same as the phone app. With a `state` it is
 * the vehicle's 3D picture by type in its status colour (green moving, orange idling, red
 * stopped, purple parked, grey not reporting) on a soft tile of that colour. Without one it is
 * the plain white truck or trailer. Decorative: the name next to it says what it is.
 */
export function VehiclePicture({ type, state, className }: { type: string | null | undefined; state?: PictureState; className?: string }) {
  const picture = state ? PICTURE_OF[type ?? "truck"] : undefined;
  if (state && !picture) {
    return (
      <span
        aria-hidden="true"
        className={cn("grid h-10 w-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-border", className)}
        style={{ background: `color-mix(in srgb, ${STATE_TINT[state]} 14%, var(--color-background))`, color: `color-mix(in srgb, ${STATE_TINT[state]} 62%, var(--color-foreground))` }}
      >
        <VehicleTypeIcon type={type} className="size-6" />
      </span>
    );
  }
  const src = picture && state ? `/fleet-art/vehicles/3d-${picture}-${state}.png` : type === "trailer" ? "/fleet-art/vehicles/vehicle-trailer@2x.png" : "/fleet-art/vehicles/vehicle-truck@2x.png";
  return (
    <span
      aria-hidden="true"
      className={cn("grid h-10 w-14 shrink-0 place-items-center overflow-hidden rounded-lg border", state ? "border-border" : "border-[#c6d2e4] bg-[#d6e0f1] dark:border-border dark:bg-muted", className)}
      style={state ? { background: `color-mix(in srgb, ${STATE_TINT[state]} 14%, var(--color-background))` } : undefined}
    >
      {/* A plain <img>: a small fixed file from /public, no resizing needed. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="h-[86%] w-[90%] object-contain" />
    </span>
  );
}
