import { sql } from "drizzle-orm";
import { index, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { drivers } from "./drivers";
import { organizations } from "./organizations";
import { vehicles } from "./vehicles";

/**
 * History of which vehicle each driver drove, and when. `unassignedAt IS NULL` is the
 * current assignment (it mirrors drivers.vehicle_id). Written only by lib/drivers.ts.
 */
export const driverAssignments = pgTable(
  "driver_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => drivers.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    unassignedAt: timestamp("unassigned_at", { withTimezone: true })
  },
  (t) => [
    index("driver_assignments_driver_idx").on(t.organizationId, t.driverId, t.assignedAt),
    index("driver_assignments_vehicle_idx").on(t.organizationId, t.vehicleId, t.assignedAt),
    uniqueIndex("driver_assignments_one_open_per_driver").on(t.driverId).where(sql`${t.unassignedAt} is null`),
    uniqueIndex("driver_assignments_one_open_per_vehicle").on(t.vehicleId).where(sql`${t.unassignedAt} is null`)
  ]
);
