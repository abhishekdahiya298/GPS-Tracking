import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Text-message codes that prove a phone number during sign-up (and driver join). Only a hash of
 * the code is kept; a code expires after 10 minutes and allows 5 tries.
 */
export const phoneCodes = pgTable(
  "phone_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** E.164, e.g. +19055550121. */
    phone: text("phone").notNull(),
    /** signup | driver_join */
    purpose: text("purpose").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("phone_codes_phone_idx").on(t.phone, t.createdAt)]
);
