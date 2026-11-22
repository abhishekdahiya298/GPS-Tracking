import { sql } from "drizzle-orm";
import { doublePrecision, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const vehicleStatusEnum = pgEnum("vehicle_status", ["active", "inactive", "maintenance"]);

export const vehicles = pgTable("vehicles", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  licensePlate: text("license_plate"),
  /** Kind of vehicle (drives the map icon). Validated by the API; plain text so new kinds need no migration. */
  type: text("type").notNull().default("truck"),
  status: vehicleStatusEnum("status").notNull().default("active"),
  /** Optional details. All nullable: a vehicle needs only a name. */
  vin: text("vin"),
  modelYear: integer("model_year"),
  make: text("make"),
  model: text("model"),
  /** State or province on the plate, e.g. "ON" or "NY". */
  plateRegion: text("plate_region"),
  fuelType: text("fuel_type"),
  color: text("color"),
  /** The company's own fleet number. */
  unitNumber: text("unit_number"),
  /** Odometer reading the customer entered, and when; trips add to it for maintenance. */
  odometerKm: doublePrecision("odometer_km"),
  odometerSetAt: timestamp("odometer_set_at", { withTimezone: true }),
  /** Customer's list order: lower first; null = after all numbered vehicles. */
  sortOrder: integer("sort_order"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  // One vehicle per VIN within a company (VINs are stored upper-case).
  uniqueIndex("vehicles_org_vin_uq").on(t.organizationId, t.vin).where(sql`${t.vin} is not null`)
]);
