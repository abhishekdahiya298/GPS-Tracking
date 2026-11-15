import { cn } from "@/lib/cn";

/**
 * The vehicle picture used on lists and cards, the same two drawings as the phone app:
 * one white tractor-trailer for every powered vehicle and one trailer for trailers,
 * on a soft blue tile. Decorative: the name next to it says what it is.
 */
export function VehiclePicture({ type, className }: { type: string | null | undefined; className?: string }) {
  const src = type === "trailer" ? "/fleet-art/vehicles/vehicle-trailer@2x.png" : "/fleet-art/vehicles/vehicle-truck@2x.png";
  return (
    <span aria-hidden="true" className={cn("grid h-10 w-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-[#d3ddeb] bg-[#e2eaf7] dark:border-border dark:bg-muted", className)}>
      {/* A plain <img>: a small fixed file from /public, no resizing needed. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="h-[86%] w-[90%] object-contain" />
    </span>
  );
}
