import { z } from "zod";

/**
 * Vehicle/device input schemas shared by API routes (authoritative) and forms
 * (instant feedback). Pure zod: safe to import in client components.
 */
export const VehicleInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Use at most 120 characters"),
  licensePlate: z
    .string()
    .trim()
    .max(32, "Use at most 32 characters")
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  status: z.enum(["active", "inactive", "maintenance"]).optional()
});
export const VehiclePatchSchema = VehicleInputSchema.partial().refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const DevicePatchSchema = z
  .object({
    name: z.string().trim().max(80, "Use at most 80 characters").nullable().optional(),
    active: z.boolean().optional()
  })
  .refine((v) => v.name !== undefined || v.active !== undefined, "Nothing to update");
