import { sql } from "drizzle-orm";
import { boolean, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { drivers } from "./drivers";
import { loads } from "./loads";
import { organizations } from "./organizations";
import { users } from "./users";

/**
 * Load paperwork settings per company (A39): which items the driver sends at pickup and delivery
 * (Off / Optional / Required) and who gets the load packet. `items` follows PaperworkItem in
 * apps/web/src/lib/paperwork.ts; null means the RIO GPS defaults.
 */
export const paperworkSettings = pgTable("paperwork_settings", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  items: jsonb("items"),
  /** Extra emails for the load packet. */
  recipients: jsonb("recipients").notNull().default(sql`'[]'::jsonb`),
  /** Also send the packet to the person who created the load. */
  toCreator: boolean("to_creator").notNull().default(true),
  /** delivered | complete | manual */
  sendWhen: text("send_when").notNull().default("delivered"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

/**
 * A document or photo sent for a load (A40): by the driver from the app, or uploaded by the team.
 * The file lives in the document store under `fileKey` (never public); time and place are
 * recorded where it was taken.
 */
export const loadDocuments = pgTable(
  "load_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    loadId: uuid("load_id")
      .notNull()
      .references(() => loads.id, { onDelete: "cascade" }),
    /** The paperwork item it answers (e.g. "pickup_bol"), or "other". */
    itemKey: text("item_key").notNull(),
    stop: text("stop").notNull(),
    fileKey: text("file_key").notNull(),
    fileName: text("file_name"),
    contentType: text("content_type").notNull(),
    bytes: integer("bytes").notNull(),
    /** scan | camera | upload */
    method: text("method"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    driverId: uuid("driver_id").references(() => drivers.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true })
  },
  (t) => [index("load_documents_load_idx").on(t.loadId, t.createdAt), index("load_documents_driver_idx").on(t.driverId).where(sql`${t.driverId} is not null`)]
);
