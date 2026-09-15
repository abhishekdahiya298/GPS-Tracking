import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

/**
 * Only "traccar" exists today, but modeling it as a table (not a hardcoded string)
 * means a second provider integration never requires a GpsDevice schema change.
 */
export const gpsProviderKindEnum = pgEnum("gps_provider_kind", ["traccar"]);

export const gpsProviders = pgTable("gps_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  kind: gpsProviderKindEnum("kind").notNull().default("traccar"),
  name: text("name").notNull(),
  apiBaseUrl: text("api_base_url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});
