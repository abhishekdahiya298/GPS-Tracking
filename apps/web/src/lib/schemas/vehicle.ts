import { z } from "zod";

/**
 * Vehicle/device input schemas shared by API routes (authoritative) and forms
 * (instant feedback). Pure zod: safe to import in client components.
 */
/** Kinds of vehicle. The kind picks the icon on the map and in lists. */
export const VEHICLE_TYPES = ["semi", "truck", "trailer", "box_truck", "tanker", "dump_truck", "mixer", "garbage_truck", "van", "pickup", "car", "motorcycle", "bus", "school_bus", "excavator", "tractor", "equipment", "other"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];
export const VEHICLE_TYPE_LABEL: Record<VehicleType, string> = {
  truck: "Truck + trailer",
  semi: "Truck",
  trailer: "Trailer",
  box_truck: "Box truck",
  tanker: "Tanker",
  dump_truck: "Dump truck",
  mixer: "Mixer",
  garbage_truck: "Garbage truck",
  van: "Van",
  pickup: "Pickup",
  car: "Car",
  motorcycle: "Motorcycle",
  bus: "Bus",
  school_bus: "School bus",
  excavator: "Excavator",
  tractor: "Farm tractor",
  equipment: "Equipment",
  other: "Other"
};
export const DEFAULT_VEHICLE_TYPE: VehicleType = "truck";
/** Any stored value that isn't a known kind (older data) is shown as "other". */
export function asVehicleType(v: unknown): VehicleType {
  return (VEHICLE_TYPES as readonly string[]).includes(v as string) ? (v as VehicleType) : "other";
}

export const FUEL_TYPES = ["diesel", "gasoline", "electric", "hybrid", "cng", "propane", "other"] as const;
export const FUEL_LABEL: Record<(typeof FUEL_TYPES)[number], string> = {
  diesel: "Diesel",
  gasoline: "Gasoline",
  electric: "Electric",
  hybrid: "Hybrid",
  cng: "CNG",
  propane: "Propane",
  other: "Other"
};

/** Optional trimmed text: "" and missing both become null. */
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

/** Optional whole number from a form ("" or missing → null). */
const optInt = (min: number, max: number, msg: string) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .nullable()
    .transform((v, ctx) => {
      if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
      const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s]/g, ""));
      if (!Number.isInteger(n) || n < min || n > max) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg });
        return z.NEVER;
      }
      return n;
    });

/** 17 characters, digits and capitals, never I, O or Q (ISO 3779). */
export const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
export function normalizeVin(v: string) {
  return v.replace(/[\s-]/g, "").toUpperCase();
}
/** Plain-language reason a VIN is not valid, or null when it is (or empty). */
export function vinProblem(raw: string): string | null {
  const v = normalizeVin(raw);
  if (!v) return null;
  if (/[^A-Z0-9]/.test(v)) return "Use only letters and numbers.";
  if (/[IOQ]/.test(v)) return "VINs never use the letters I, O or Q. Did you mean 1 or 0?";
  if (v.length < 17) return `${v.length} characters: a VIN has 17. ${17 - v.length === 1 ? "One character is" : `${17 - v.length} characters are`} missing.`;
  if (v.length > 17) return `${v.length} characters: a VIN has 17. Remove ${v.length - 17 === 1 ? "the extra character" : `${v.length - 17} extra characters`}.`;
  return null;
}
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
const VIN_VALUES: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
/**
 * North American check digit (position 9). Only a hint: many older and non-US
 * vehicles don't use it, so a mismatch never blocks saving.
 */
export function vinCheckDigitOk(vin: string) {
  if (!VIN_RE.test(vin)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin[i]!;
    sum += (/\d/.test(c) ? Number(c) : VIN_VALUES[c] ?? 0) * VIN_WEIGHTS[i]!;
  }
  const r = sum % 11;
  return vin[8] === (r === 10 ? "X" : String(r));
}

const currentYear = new Date().getUTCFullYear();

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
  type: z.enum(VEHICLE_TYPES).optional(),
  vin: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? normalizeVin(v) : null))
    .superRefine((v, ctx) => {
      const problem = v === null ? null : vinProblem(v);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
  modelYear: optInt(1950, currentYear + 2, `Enter a year between 1950 and ${currentYear + 2}`),
  make: optText(60),
  model: optText(60),
  plateRegion: optText(40),
  fuelType: z.enum(FUEL_TYPES).optional().nullable(),
  color: optText(30),
  unitNumber: optText(32),
  /** Kilometres; forms convert from the company's unit before sending. */
  odometerKm: z
    .union([z.number(), z.string()])
    .optional()
    .nullable()
    .transform((v, ctx) => {
      if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
      const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s]/g, ""));
      if (!Number.isFinite(n) || n < 0 || n > 10_000_000) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter the odometer as a number" });
        return z.NEVER;
      }
      return Math.round(n * 10) / 10;
    }),
  sortOrder: optInt(1, 9999, "Use a number from 1 to 9999")
});
export const VehiclePatchSchema = VehicleInputSchema.partial().refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const DevicePatchSchema = z
  .object({
    name: z.string().trim().max(80, "Use at most 80 characters").nullable().optional(),
    active: z.boolean().optional()
  })
  .refine((v) => v.name !== undefined || v.active !== undefined, "Nothing to update");
