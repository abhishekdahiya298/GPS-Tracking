import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});
