import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { gpsDevices } from "./gpsDevices";
import { organizations } from "./organizations";
import { vehicles } from "./vehicles";

export const geofenceKindEnum = pgEnum("geofence_kind", ["circle", "polygon"]);
export const alertTypeEnum = pgEnum("alert_type", [
  "geofence_enter",
  "geofence_exit",
  "speeding",
  "ignition_on",
  "ignition_off",
  "device_offline"
]);

/** Zones. Circle: center + radius. Polygon: ring of [lon, lat] (open ring, 3–200 points). */
export const geofences = pgTable(
  "geofences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: geofenceKindEnum("kind").notNull(),
    centerLat: doublePrecision("center_lat"),
    centerLon: doublePrecision("center_lon"),
    radiusM: integer("radius_m"),
    polygon: jsonb("polygon").$type<[number, number][]>(),
    color: text("color").notNull().default("#3056d3"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("geofences_org_idx").on(t.organizationId)]
);

export const alertRules = pgTable(
  "alert_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: alertTypeEnum("type").notNull(),
    /** null = every vehicle/device in the organization. */
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "cascade" }),
    geofenceId: uuid("geofence_id").references(() => geofences.id, { onDelete: "cascade" }),
    speedKph: integer("speed_kph"),
    offlineMinutes: integer("offline_minutes"),
    notifyEmail: boolean("notify_email").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("alert_rules_org_active_idx").on(t.organizationId, t.active)]
);

/** Per (rule, device) edge-detection state, so events fire on transitions only. */
export const alertRuleState = pgTable(
  "alert_rule_state",
  {
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => alertRules.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => gpsDevices.id, { onDelete: "cascade" }),
    state: jsonb("state").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [primaryKey({ columns: [t.ruleId, t.deviceId] })]
);

export const alertEvents = pgTable(
  "alert_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ruleId: uuid("rule_id").references(() => alertRules.id, { onDelete: "set null" }),
    ruleName: text("rule_name").notNull(),
    type: alertTypeEnum("type").notNull(),
    deviceId: uuid("device_id").references(() => gpsDevices.id, { onDelete: "set null" }),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedBy: uuid("acknowledged_by").references(() => users.id, { onDelete: "set null" })
  },
  (t) => [
    index("alert_events_org_occurred_idx").on(t.organizationId, t.occurredAt),
    index("alert_events_org_unack_idx").on(t.organizationId).where(sql`${t.acknowledgedAt} is null`)
  ]
);
