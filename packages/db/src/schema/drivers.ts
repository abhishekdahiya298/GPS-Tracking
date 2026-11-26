import { date, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { gpsDevices } from "./gpsDevices";
import { vehicles } from "./vehicles";

export const driverStatusEnum = pgEnum("driver_status", ["active", "inactive"]);

/**
 * A driver of the organization. vehicleId is the vehicle they drive now (one driver per
 * vehicle at a time); null when not assigned. A driver may sign in to the driver app; their phone
 * then reports as `phoneDeviceId` (a gps_devices row of kind "phone").
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
    phoneDeviceId: uuid("phone_device_id").references(() => gpsDevices.id, { onDelete: "set null" }),
    /**
     * The driver's consent to share their phone with this company (driver-first model):
     * pending (the company asked), active (the driver accepted), declined, or left. Location from the
     * driver app is stored for a company only while this is active.
     */
    appLink: text("app_link").notNull().default("active"),
    appLinkAt: timestamp("app_link_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("drivers_org_idx").on(t.organizationId), uniqueIndex("drivers_vehicle_uq").on(t.vehicleId).where(sql`${t.vehicleId} is not null`)]
);
