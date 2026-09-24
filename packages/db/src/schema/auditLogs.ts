import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

/**
 * Append-only record of security-sensitive actions. Never store secrets,
 * passwords, tokens or cookies in `metadata`.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    /** e.g. "auth.login", "auth.login_failed", "auth.logout", "user.created", "membership.created" */
    action: text("action").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    targetType: text("target_type"),
    targetId: text("target_id"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>()
  },
  (table) => [
    index("audit_logs_org_occurred_idx").on(table.organizationId, table.occurredAt),
    index("audit_logs_actor_occurred_idx").on(table.actorUserId, table.occurredAt)
  ]
);
