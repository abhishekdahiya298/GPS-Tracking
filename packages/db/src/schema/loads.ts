import { sql } from "drizzle-orm";
import { bigint, doublePrecision, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

/** Mirrors LOAD_STATUSES in @rio-gps/core/loads. */
export const loadStatusEnum = pgEnum("load_status", ["invited", "tracking", "at_pickup", "in_transit", "at_delivery", "delivered", "cancelled", "declined"]);

/**
 * A broker's shipment, tracked through the driver's phone for the length of the load only.
 *
 * Privacy: the driver's position is collected only between the driver accepting the invite
 * (consent, recorded in acceptedAt / consentUserAgent) and the load ending. The driver can
 * stop sharing at any time (sharingStoppedAt). Positions belong to the load and are deleted
 * with it.
 *
 * Tokens: the driver link and the shipper link each carry 256 random bits; only their SHA-256
 * is stored. Rotating the driver token (re-sending the invite) invalidates the old link.
 */
export const loads = pgTable(
  "loads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** The broker's load number, e.g. "L-10432". Unique per organization. */
    reference: text("reference").notNull(),
    status: loadStatusEnum("status").notNull().default("invited"),
    carrierName: text("carrier_name"),
    driverName: text("driver_name"),
    /** E.164, e.g. +14165550123. */
    driverPhone: text("driver_phone").notNull(),
    notes: text("notes"),

    pickupName: text("pickup_name"),
    pickupAddress: text("pickup_address").notNull(),
    pickupLat: doublePrecision("pickup_lat").notNull(),
    pickupLon: doublePrecision("pickup_lon").notNull(),
    pickupRadiusM: integer("pickup_radius_m").notNull().default(500),
    pickupAppointmentAt: timestamp("pickup_appointment_at", { withTimezone: true }),

    deliveryName: text("delivery_name"),
    deliveryAddress: text("delivery_address").notNull(),
    deliveryLat: doublePrecision("delivery_lat").notNull(),
    deliveryLon: doublePrecision("delivery_lon").notNull(),
    deliveryRadiusM: integer("delivery_radius_m").notNull().default(500),
    deliveryAppointmentAt: timestamp("delivery_appointment_at", { withTimezone: true }),

    driverTokenHash: text("driver_token_hash").notNull(),
    shipperTokenHash: text("shipper_token_hash"),
    inviteSentAt: timestamp("invite_sent_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    consentUserAgent: text("consent_user_agent"),
    /** Set while the driver has paused sharing; cleared when they resume. */
    sharingStoppedAt: timestamp("sharing_stopped_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),

    lastLat: doublePrecision("last_lat"),
    lastLon: doublePrecision("last_lon"),
    lastAccuracyM: doublePrecision("last_accuracy_m"),
    lastSpeedKph: doublePrecision("last_speed_kph"),
    lastPositionAt: timestamp("last_position_at", { withTimezone: true }),

    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex("loads_org_reference_unique").on(t.organizationId, t.reference),
    index("loads_org_created_idx").on(t.organizationId, t.createdAt),
    uniqueIndex("loads_driver_token_unique").on(t.driverTokenHash),
    uniqueIndex("loads_shipper_token_unique")
      .on(t.shipperTokenHash)
      .where(sql`${t.shipperTokenHash} is not null`)
  ]
);

/** The load's timeline (status changes, invites, consent). Append-only. */
export const loadEvents = pgTable(
  "load_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    loadId: uuid("load_id")
      .notNull()
      .references(() => loads.id, { onDelete: "cascade" }),
    /** Mirrors LOAD_EVENT_TYPES in @rio-gps/core/loads (plain text so new kinds need no migration). */
    type: text("type").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    /** null for driver and automatic events. */
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    detail: jsonb("detail")
  },
  (t) => [index("load_events_load_idx").on(t.loadId, t.at)]
);

/** Positions from the driver's phone, only while the load is tracked. Deleted with the load. */
export const loadPings = pgTable(
  "load_pings",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    loadId: uuid("load_id")
      .notNull()
      .references(() => loads.id, { onDelete: "cascade" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    accuracyM: doublePrecision("accuracy_m"),
    speedKph: doublePrecision("speed_kph"),
    headingDeg: doublePrecision("heading_deg"),
    /** "web" (driver page) or "app" (mobile driver mode). */
    source: text("source").notNull().default("web")
  },
  (t) => [uniqueIndex("load_pings_load_recorded_unique").on(t.loadId, t.recordedAt)]
);
