import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * A "Get pricing" request from the public site. Platform data (no organization): only
 * super admins can read it. Holds just what the person typed; no IP address is stored.
 */
export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    company: text("company").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    /** Fleet size band chosen in the form, e.g. "6-20". */
    fleetSize: text("fleet_size").notNull(),
    /** "CA" or "US". */
    country: text("country").notNull(),
    message: text("message"),
    /** new | contacted | closed */
    status: text("status").notNull().default("new"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("leads_created_idx").on(t.createdAt)]
);
