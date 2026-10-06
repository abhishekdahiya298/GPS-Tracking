import { date, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { vehicles } from "./vehicles";

/**
 * A dated renewal to remember: licence plate registration, insurance, safety inspection,
 * permit and so on. For one vehicle, or company-wide when `vehicleId` is null.
 */
export const renewalReminders = pgTable(
  "renewal_reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "cascade" }),
    /** "registration" | "insurance" | "inspection" | "permit" | "licence" | "other" (validated in the app). */
    type: text("type").notNull(),
    title: text("title").notNull(),
    /** Calendar day it expires (the last valid day), in the organization's time zone. */
    dueDate: date("due_date", { mode: "string" }).notNull(),
    /** Start warning this many days before the due date. */
    remindDays: integer("remind_days").notNull().default(30),
    notifyUserIds: jsonb("notify_user_ids").$type<string[]>().notNull().default([]),
    /** Last state emailed ("due_soon" | "overdue"); reset when renewed. */
    notifiedState: text("notified_state"),
    note: text("note"),
    /** When it was last renewed in the app (for the record). */
    lastRenewedAt: timestamp("last_renewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("renewal_reminders_org_due_idx").on(t.organizationId, t.dueDate), index("renewal_reminders_vehicle_idx").on(t.vehicleId)]
);
