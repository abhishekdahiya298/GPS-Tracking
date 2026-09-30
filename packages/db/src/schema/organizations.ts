import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Display units only; stored GPS values are always metric. */
export const unitSystemEnum = pgEnum("unit_system", ["imperial", "metric"]);

/** Clock used for display (12-hour with AM/PM, or 24-hour). */
export const timeFormatEnum = pgEnum("time_format", ["12h", "24h"]);

/**
 * Tenant root. Every other table (directly or transitively) carries organizationId,
 * enforced at the application layer today; a future migration can add Postgres RLS
 * policies keyed on this column without changing the shape of any table.
 */
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  unitSystem: unitSystemEnum("unit_system").notNull().default("imperial"),
  /** Default IANA time zone for display, reports, day boundaries and emails. Instants stay UTC. */
  timeZone: text("time_zone").notNull().default("America/Toronto"),
  timeFormat: timeFormatEnum("time_format").notNull().default("12h"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});
