import { z } from "zod";

/**
 * Vehicle/device input schemas shared by API routes (authoritative) and forms
 * (instant feedback). Pure zod: safe to import in client components.
 */
/** Kinds of vehicle. The kind picks the icon on the map and in lists. */
export const VEHICLE_TYPES = ["truck", "semi", "trailer", "van", "pickup", "car", "bus", "equipment", "other"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];
export const VEHICLE_TYPE_LABEL: Record<VehicleType, string> = {
  truck: "Truck",
  semi: "Tractor (semi)",
  trailer: "Trailer",
  van: "Van",
  pickup: "Pickup",
  car: "Car",
  bus: "Bus",
  equipment: "Equipment",
  other: "Other"
};
export const DEFAULT_VEHICLE_TYPE: VehicleType = "truck";
/** Any stored value that isn't a known kind (older data) is shown as "other". */
export function asVehicleType(v: unknown): VehicleType {
  return (VEHICLE_TYPES as readonly string[]).includes(v as string) ? (v as VehicleType) : "other";
}

export const VehicleInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Use at most 120 characters"),
  licensePlate: z
    .string()
    .trim()
    .max(32, "Use at most 32 characters")
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  status: z.enum(["active", "inactive", "maintenance"]).optional(),
  type: z.enum(VEHICLE_TYPES).optional()
});
export const VehiclePatchSchema = VehicleInputSchema.partial().refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const DevicePatchSchema = z
  .object({
    name: z.string().trim().max(80, "Use at most 80 characters").nullable().optional(),
    active: z.boolean().optional()
  })
  .refine((v) => v.name !== undefined || v.active !== undefined, "Nothing to update");
