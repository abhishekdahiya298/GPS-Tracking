import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";
import { vehicles } from "./vehicles";

/**
 * A temporary public link to one vehicle's live position (no sign-in). Only the SHA-256 of
 * the token is stored, so a database leak does not reveal working links; the link itself
 * is shown once, when it is created.
 */
export const shareLinks = pgTable(
  "share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    /** Who it was made for (shown in the list only; never on the public page). */
    label: text("label"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
    viewCount: integer("view_count").notNull().default(0)
  },
  (t) => [uniqueIndex("share_links_token_hash_unique").on(t.tokenHash), index("share_links_org_idx").on(t.organizationId, t.expiresAt), index("share_links_vehicle_idx").on(t.vehicleId)]
);
