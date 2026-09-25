import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";
import { vehicles } from "./vehicles";

/** A recurring service for one vehicle, due by distance and/or time since the last service. */
export const maintenanceItems = pgTable(
  "maintenance_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    intervalKm: integer("interval_km"),
    intervalDays: integer("interval_days"),
    lastServiceAt: timestamp("last_service_at", { withTimezone: true }).notNull(),
    /** Dashboard odometer reading at the last service, for the record only. */
    lastServiceOdometerKm: integer("last_service_odometer_km"),
    notifyUserIds: jsonb("notify_user_ids").$type<string[]>().notNull().default([]),
    /** Last state emailed ("due_soon" | "overdue"); reset when serviced. */
    notifiedState: text("notified_state"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("maintenance_items_org_idx").on(t.organizationId), index("maintenance_items_vehicle_idx").on(t.vehicleId)]
);

/** Service history. */
export const maintenanceRecords = pgTable(
  "maintenance_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => maintenanceItems.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    servicedAt: timestamp("serviced_at", { withTimezone: true }).notNull(),
    odometerKm: integer("odometer_km"),
    kmSincePrevious: integer("km_since_previous"),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("maintenance_records_item_idx").on(t.itemId, t.servicedAt)]
);
