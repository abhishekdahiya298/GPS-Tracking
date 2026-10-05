import { sql } from "drizzle-orm";
import { index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { vehicles } from "./vehicles";

/** A named set of vehicles inside one organization (a vehicle can be in several groups). */
export const vehicleGroups = pgTable(
  "vehicle_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [uniqueIndex("vehicle_groups_org_name_unique").on(t.organizationId, sql`lower(${t.name})`)]
);

export const vehicleGroupMembers = pgTable(
  "vehicle_group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => vehicleGroups.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    /** Denormalized so every membership query can be tenant-scoped directly. */
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [primaryKey({ columns: [t.groupId, t.vehicleId] }), index("vehicle_group_members_vehicle_idx").on(t.vehicleId)]
);
