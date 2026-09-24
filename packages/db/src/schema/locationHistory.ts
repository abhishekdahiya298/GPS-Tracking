import { sql } from "drizzle-orm";
import { bigint, boolean, doublePrecision, index, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { gpsDevices } from "./gpsDevices";
import { organizations } from "./organizations";
import { vehicles } from "./vehicles";

/**
 * Append-only GPS track: one row per accepted fix, including backlog records a
 * device uploads late (which never replace current_locations).
 *
 * Dedupe: (device_id, recorded_at) is unique, so Traccar redeliveries and
 * repeated backlog uploads are idempotent (INSERT … ON CONFLICT DO NOTHING).
 * That same index serves the per-device time-range history query.
 *
 * vehicle_id is the device's active assignment *at ingest time*, so history
 * stays attributed correctly after a device moves to another vehicle.
 * Coordinates use double precision, matching current_locations (sub-mm precision).
 */
export const locationHistory = pgTable(
  "location_history",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => gpsDevices.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    speedKph: doublePrecision("speed_kph"),
    headingDeg: doublePrecision("heading_deg"),
    altitudeM: doublePrecision("altitude_m"),
    ignition: boolean("ignition"),
    motion: boolean("motion")
  },
  (table) => [
    uniqueIndex("location_history_device_recorded_unique").on(table.deviceId, table.recordedAt),
    index("location_history_org_recorded_idx").on(table.organizationId, table.recordedAt),
    index("location_history_vehicle_recorded_idx")
      .on(table.vehicleId, table.recordedAt)
      .where(sql`${table.vehicleId} is not null`)
  ]
);
