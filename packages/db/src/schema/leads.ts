import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

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
    /** website (Get pricing) | upgrade (a customer's Request upgrade) | signup (new free sign-up). */
    source: text("source").notNull().default("website"),
    /** The customer who asked (upgrade requests and sign-ups). */
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    /** Their plan when they asked. */
    planName: text("plan_name"),
    /** What they asked for (core FEATURES or "more_vehicles"…). */
    needs: text("needs").array().notNull().default(sql`'{}'::text[]`),
    /** phone | whatsapp | email */
    contactWay: text("contact_way"),
    /** new | contacted | closed */
    status: text("status").notNull().default("new"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("leads_created_idx").on(t.createdAt)]
);
