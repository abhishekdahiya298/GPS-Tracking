import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Display units only; stored GPS values are always metric. */
export const unitSystemEnum = pgEnum("unit_system", ["imperial", "metric"]);

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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});
