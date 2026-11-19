import { date, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { vehicles } from "./vehicles";

export const driverStatusEnum = pgEnum("driver_status", ["active", "inactive"]);

/**
 * A driver of the organization. vehicleId is the vehicle they drive now (one driver per
 * vehicle at a time); null when not assigned. Drivers are records, not app logins.
 */
export const drivers = pgTable(
  "drivers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    licenseNumber: text("license_number"),
    licenseExpiresOn: date("license_expires_on"),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    status: driverStatusEnum("status").notNull().default("active"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("drivers_org_idx").on(t.organizationId), uniqueIndex("drivers_vehicle_uq").on(t.vehicleId).where(sql`${t.vehicleId} is not null`)]
);
