import { sql } from "drizzle-orm";
import { boolean, index, integer, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

/**
 * Plans and usage (platform side). Customers pay by manual invoice for now; RIO records what
 * each customer bought and what they used, so a monthly statement can be produced exactly.
 *
 * - `plans`: the catalog the platform offers (templates). Editing a plan never changes what
 *   existing customers pay: a customer's terms are copied into `subscriptions` when assigned.
 * - `subscriptions`: each customer's terms over time; exactly one open row (ended_at null).
 * - `billable_loads`: one row per load that started tracking, written once and never removed
 *   (deleting or cancelling a load afterwards doesn't take it off the month it was used in).
 * - `billable_trackers`: one row per tracker per month it was with the customer.
 */

/** Product modules a plan switches on. */
export const planModuleEnum = pgEnum("plan_module", ["gps", "loads"]);

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    modules: planModuleEnum("modules").array().notNull(),
    /** Loads included each month (0 = every load is billed at the extra-load price). */
    includedLoads: integer("included_loads").notNull().default(0),
    extraLoadCents: integer("extra_load_cents").notNull().default(0),
    monthlyFeeCents: integer("monthly_fee_cents").notNull().default(0),
    /** Per tracker per month (GPS plans). */
    perTrackerCents: integer("per_tracker_cents").notNull().default(0),
    /** Offered for new assignments; customers already on it keep it either way. */
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [uniqueIndex("plans_name_unique").on(sql`lower(${t.name})`)]
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** The catalog plan it was copied from (null if that plan was removed). */
    planId: uuid("plan_id").references(() => plans.id, { onDelete: "set null" }),
    /** Terms as agreed with this customer (copied from the plan, possibly adjusted). */
    planName: text("plan_name").notNull(),
    modules: planModuleEnum("modules").array().notNull(),
    includedLoads: integer("included_loads").notNull().default(0),
    extraLoadCents: integer("extra_load_cents").notNull().default(0),
    monthlyFeeCents: integer("monthly_fee_cents").notNull().default(0),
    perTrackerCents: integer("per_tracker_cents").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    changedBy: uuid("changed_by").references(() => users.id, { onDelete: "set null" }),
    note: text("note")
  },
  (t) => [
    uniqueIndex("subscriptions_one_open").on(t.organizationId).where(sql`${t.endedAt} is null`),
    index("subscriptions_org_started_idx").on(t.organizationId, t.startedAt)
  ]
);

export const billableLoads = pgTable(
  "billable_loads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** No foreign key on purpose: the row stays when the load is deleted. */
    loadId: uuid("load_id").notNull(),
    reference: text("reference").notNull(),
    /** Calendar month in the organization's time zone, "YYYY-MM". */
    period: text("period").notNull(),
    countedAt: timestamp("counted_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [uniqueIndex("billable_loads_load_unique").on(t.loadId), index("billable_loads_org_period_idx").on(t.organizationId, t.period)]
);

export const billableTrackers = pgTable(
  "billable_trackers",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").notNull(),
    imei: text("imei").notNull(),
    period: text("period").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.deviceId, t.period] }), index("billable_trackers_org_period_idx").on(t.organizationId, t.period)]
);
