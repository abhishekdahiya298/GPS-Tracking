import { z } from "zod";

/** Public "Get pricing" form. Shared by the form (instant feedback) and the API (authoritative). */
export const FLEET_SIZES = ["1-5", "6-20", "21-50", "51-200", "200+"] as const;
export const LEAD_COUNTRIES = ["CA", "US"] as const;
export const LEAD_STATUSES = ["new", "contacted", "closed"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const LeadInputSchema = z.object({
  name: z.string().trim().min(1, "Your name is required").max(120, "Use at most 120 characters"),
  company: z.string().trim().min(1, "Company name is required").max(160, "Use at most 160 characters"),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
  phone: optional(40),
  fleetSize: z.enum(FLEET_SIZES, { message: "Choose a fleet size" }),
  country: z.enum(LEAD_COUNTRIES, { message: "Choose a country" }),
  message: optional(2000),
  /** Honeypot: hidden from people, filled by bots. */
  website: z.string().max(200).optional()
});
export type LeadInput = z.infer<typeof LeadInputSchema>;
