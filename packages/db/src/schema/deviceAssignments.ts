import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { gpsDevices } from "./gpsDevices";
import { organizations } from "./organizations";
import { vehicles } from "./vehicles";

/**
 * History of which vehicle a device was mounted on. `unassignedAt IS NULL` means
 * the assignment is currently active — callers should filter on that rather than
 * assuming one row per device.
 */
export const deviceAssignments = pgTable("device_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  deviceId: uuid("device_id")
    .notNull()
    .references(() => gpsDevices.id, { onDelete: "cascade" }),
  vehicleId: uuid("vehicle_id")
    .notNull()
    .references(() => vehicles.id, { onDelete: "cascade" }),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  unassignedAt: timestamp("unassigned_at", { withTimezone: true })
});
