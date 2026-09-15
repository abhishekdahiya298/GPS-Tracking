import { doublePrecision, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { gpsDevices } from "./gpsDevices";
import { organizations } from "./organizations";

/**
 * One row per device: the latest known position, upserted on every ingest.
 * LocationHistory (append-only, added later) will share the same column shape
 * so the ingest path can write to both without remapping fields.
 */
export const currentLocations = pgTable("current_locations", {
  deviceId: uuid("device_id")
    .primaryKey()
    .references(() => gpsDevices.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  speedKph: doublePrecision("speed_kph"),
  headingDeg: doublePrecision("heading_deg"),
  altitudeM: doublePrecision("altitude_m"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  rawPayload: jsonb("raw_payload")
});
