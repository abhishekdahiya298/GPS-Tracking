import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Display units only; stored GPS values are always metric. */
export const unitSystemEnum = pgEnum("unit_system", ["imperial", "metric"]);

/** Clock used for display (12-hour with AM/PM, or 24-hour). */
export const timeFormatEnum = pgEnum("time_format", ["12h", "24h"]);

/**
 * Customer lifecycle, set by a platform admin. Nothing is ever hard-deleted from here:
 * - active: normal use.
 * - suspended (e.g. unpaid): nobody can sign in to it and no alerts, emails or reports go
 *   out, but trackers keep recording so no history is lost.
 * - archived (soft delete): as suspended, and tracker positions are no longer stored; hidden
 *   from the customer list by default. Everything can be restored.
 */
export const organizationStatusEnum = pgEnum("organization_status", ["active", "suspended", "archived"]);

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
  status: organizationStatusEnum("status").notNull().default("active"),
  /** Why it was suspended or archived (shown to platform admins only). */
  statusReason: text("status_reason"),
  statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
  /** Platform admin who last changed the status (the audit log has the full history). */
  statusChangedBy: uuid("status_changed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});
