import { boolean, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

/**
 * @deprecated Legacy v0 role enum, superseded by `memberships.role` (org_role).
 * Kept (unused) so migration 0001 stays non-destructive; drop in a later,
 * explicitly approved migration.
 */
export const userRoleEnum = pgEnum("user_role", ["owner", "admin", "viewer"]);

/**
 * Global user accounts (one row per person, across organizations). Managed by
 * Better Auth (model "users"); passwords live in `accounts`, never here.
 * Organization access comes exclusively from `memberships`.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().default(""),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    /** Platform operator: bypasses tenant membership checks. Never settable through any API. */
    isSuperAdmin: boolean("is_super_admin").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** @deprecated v0 column; organization access is via memberships. Always NULL for new users. */
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    /** @deprecated v0 column; credentials live in accounts.password. Always NULL for new users. */
    passwordHash: text("password_hash"),
    /** @deprecated v0 column; roles live in memberships.role. */
    role: userRoleEnum("role").notNull().default("viewer")
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)]
);
