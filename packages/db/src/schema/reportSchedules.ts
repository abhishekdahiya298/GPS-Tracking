import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

export const reportFrequencyEnum = pgEnum("report_frequency", ["daily", "weekly"]);

/** Scheduled trip-summary emails. Recipients must be members of the organization. */
export const reportSchedules = pgTable(
  "report_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    frequency: reportFrequencyEnum("frequency").notNull(),
    timeZone: text("time_zone").notNull(),
    sendHour: integer("send_hour").notNull(),
    /** 1=Mon … 7=Sun (weekly only). */
    weekday: integer("weekday").notNull().default(1),
    /** null = every device in the organization. */
    deviceIds: jsonb("device_ids").$type<string[] | null>(),
    recipientUserIds: jsonb("recipient_user_ids").$type<string[]>().notNull(),
    attachCsv: boolean("attach_csv").notNull().default(true),
    active: boolean("active").notNull().default(true),
    /** Idempotency: key of the last period claimed for sending (e.g. "daily:2026-09-24"). */
    lastPeriodKey: text("last_period_key"),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    lastStatus: text("last_status"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("report_schedules_org_idx").on(t.organizationId), index("report_schedules_active_idx").on(t.active)]
);
