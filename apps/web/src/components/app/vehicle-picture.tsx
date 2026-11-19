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
/** A vehicle list/detail state as a picture colour (no device: no colour, the plain picture). */
export function pictureState(state: string | null | undefined): PictureState | undefined {
  switch (state) {
    case "moving":
    case "idle":
    case "stopped":
    case "parked":
    case "offline":
      return state;
    case "never_seen":
    case "inactive":
      return "offline";
    default:
      return undefined;
  }
}

/** The 3D picture file for a vehicle type in a state, or null for types drawn as a symbol. */
export function vehiclePictureSrc(type: string | null | undefined, state: PictureState): string | null {
  const picture = PICTURE_OF[type ?? "truck"];
  return picture ? `/fleet-art/vehicles/3d-${picture}-${state}.png` : null;
}
const STATE_TINT: Record<PictureState, string> = { moving: "#0f5c2c", idle: "#8f3d06", stopped: "#9c1818", parked: "#5a1fc0", offline: "#4b5563" };

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
  // No state (no device yet): the same 3D picture of its type, in neutral grey, so a tractor still looks like a tractor.
  const known = PICTURE_OF[type ?? "truck"];
  const src = picture && state ? `/fleet-art/vehicles/3d-${picture}-${state}.png` : known ? `/fleet-art/vehicles/3d-${known}-offline.png` : type === "trailer" ? "/fleet-art/vehicles/vehicle-trailer@2x.png" : "/fleet-art/vehicles/vehicle-truck@2x.png";
  return (
    <span
      aria-hidden="true"
      className={cn("grid h-10 w-14 shrink-0 place-items-center overflow-hidden rounded-lg border", state ? "border-border" : "border-[#c6d2e4] bg-[#d6e0f1] dark:border-border dark:bg-muted", className)}
      style={state ? { background: `linear-gradient(160deg, var(--color-background), color-mix(in srgb, ${STATE_TINT[state]} 26%, var(--color-background)))` } : undefined}
    >
      {/* A plain <img>: a small fixed file from /public, no resizing needed. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" loading="eager" decoding="async" className="h-[86%] w-[90%] object-contain" />
    </span>
  );
}
