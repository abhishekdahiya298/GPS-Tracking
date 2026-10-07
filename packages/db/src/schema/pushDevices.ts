import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

/**
 * A phone that should receive push notifications for one user in one organization.
 * `token` is the push address issued by the push service (an Expo push token); it is
 * unique, so a phone handed to another user simply moves to them.
 */
export const pushDevices = pgTable(
  "push_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    /** "ios" | "android" */
    platform: text("platform").notNull(),
    /** Which alert kinds this phone wants. */
    speeding: boolean("speeding").notNull().default(true),
    zones: boolean("zones").notNull().default(true),
    offline: boolean("offline").notNull().default(true),
    maintenance: boolean("maintenance").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [uniqueIndex("push_devices_token_unique").on(t.token), index("push_devices_org_idx").on(t.organizationId)]
);
