import { pgEnum, pgTable, timestamp, uniqueIndex, uuid, index } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

/** Tenant roles. SUPER_ADMIN is not a membership role — it is users.is_super_admin (platform-wide). */
export const orgRoleEnum = pgEnum("org_role", ["ORG_ADMIN", "FLEET_MANAGER", "DISPATCHER", "VIEWER"]);

/** The ONLY source of a user's access to an organization. */
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: orgRoleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("memberships_user_org_unique").on(table.userId, table.organizationId),
    index("memberships_org_idx").on(table.organizationId)
  ]
);
