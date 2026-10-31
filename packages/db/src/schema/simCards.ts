import { integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { gpsDevices } from "./gpsDevices";

/**
 * - inventory: bought, not activated (no monthly charge).
 * - active: activated with the carrier (billed every month).
 * - suspended: paused with the carrier (usually a reduced charge).
 * - cancelled: closed with the carrier; kept for the record.
 */
export const simStatusEnum = pgEnum("sim_status", ["inventory", "active", "suspended", "cancelled"]);

/**
 * Data SIMs in RIO's trackers (platform only; customers never see this table). A SIM sits in at
 * most one tracker and a tracker holds at most one SIM.
 */
export const simCards = pgTable(
  "sim_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The number printed on the card (18-22 digits). */
    iccid: text("iccid").notNull(),
    /** The SIM's phone number, used for SMS configuration of the tracker. */
    msisdn: text("msisdn"),
    carrier: text("carrier"),
    plan: text("plan"),
    apn: text("apn"),
    status: simStatusEnum("status").notNull().default("inventory"),
    /** Monthly cost in cents (for spotting SIMs that are paid for but not used). */
    monthlyCostCents: integer("monthly_cost_cents"),
    deviceId: uuid("device_id").references(() => gpsDevices.id, { onDelete: "set null" }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    notes: text("notes"),
    /** "hologram" when the SIM is kept in sync from the carrier's API (status, plan, tracker); null when entered by hand. */
    provider: text("provider"),
    /** The carrier's own id for the SIM (Hologram device id). */
    providerRef: text("provider_ref"),
    /** Last time the carrier sync saw this SIM. */
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [uniqueIndex("sim_cards_iccid_unique").on(t.iccid), uniqueIndex("sim_cards_device_unique").on(t.deviceId)]
);
