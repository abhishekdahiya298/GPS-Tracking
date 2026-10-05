import { bigint, date, index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { gpsDevices } from "./gpsDevices";
import { organizations } from "./organizations";

/**
 * Derived data: one row per device per local calendar day (in the organization's time
 * zone at the time it was computed), summarizing `location_history` with the trip engine.
 * It can always be rebuilt from history; dashboards read it instead of raw points.
 */
export const deviceDailyStats = pgTable(
  "device_daily_stats",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => gpsDevices.id, { onDelete: "cascade" }),
    /** Local calendar day in `timeZone`. */
    day: date("day", { mode: "string" }).notNull(),
    /** The zone the day boundaries were computed in; rows are rebuilt when the organization's zone changes. */
    timeZone: text("time_zone").notNull(),
    distanceM: integer("distance_m").notNull().default(0),
    drivingS: integer("driving_s").notNull().default(0),
    idleS: integer("idle_s").notNull().default(0),
    trips: integer("trips").notNull().default(0),
    maxSpeedKph: integer("max_speed_kph").notNull().default(0),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.day] }), index("device_daily_stats_org_day_idx").on(t.organizationId, t.day)]
);

/** Single-row bookkeeping for the summary job: the last `location_history.id` it has processed. */
export const dailyStatsState = pgTable("daily_stats_state", {
  id: integer("id").primaryKey().default(1),
  lastHistoryId: bigint("last_history_id", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});
