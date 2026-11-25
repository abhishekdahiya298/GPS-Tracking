import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { drivers } from "./drivers";
import { organizations } from "./organizations";
import { users } from "./users";

/**
 * A signed-in driver app (one row per phone sign-in). Only a hash of the token is kept; signing out
 * or making the driver inactive revokes it.
 */
export const driverAppSessions = pgTable(
  "driver_app_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => drivers.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    platform: text("platform"),
    appVersion: text("app_version"),
    deviceModel: text("device_model"),
    /** Expo push address of this phone, so the company can reach the driver (location requests, loads). */
    pushToken: text("push_token"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true })
  },
  (t) => [index("driver_app_sessions_driver_idx").on(t.driverId)]
);

/** The driver's phone right now: battery, location permission and when it last reported. */
export const driverAppStatus = pgTable("driver_app_status", {
  driverId: uuid("driver_id")
    .primaryKey()
    .references(() => drivers.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  batteryPct: integer("battery_pct"),
  charging: boolean("charging"),
  /** always | while_using | off */
  permission: text("permission"),
  /** false when the phone's location services are switched off. */
  locationEnabled: boolean("location_enabled"),
  platform: text("platform"),
  appVersion: text("app_version"),
  signedIn: boolean("signed_in").notNull().default(false),
  lastReportAt: timestamp("last_report_at", { withTimezone: true }),
  lastFixAt: timestamp("last_fix_at", { withTimezone: true }),
  /** The company last asked the driver to turn location on (push), and who asked. Limits repeats. */
  locationAskedAt: timestamp("location_asked_at", { withTimezone: true }),
  locationAskedBy: uuid("location_asked_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

/**
 * A personal invite: the link (or QR) signs that one driver in to the app. Single use, expires.
 * Only a hash of the token is kept.
 */
export const driverInvites = pgTable(
  "driver_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => drivers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    sentTo: text("sent_to"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("driver_invites_driver_idx").on(t.driverId)]
);
