import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

export const appPlatformEnum = pgEnum("app_platform", ["android", "ios"]);

/**
 * Mobile app update policy per platform, set in the platform console (Mobile app page).
 * The app checks it on start and when it comes back to the foreground; the API refuses
 * apps older than `min_version` (426 Upgrade Required).
 */
export const appReleases = pgTable("app_releases", {
  platform: appPlatformEnum("platform").primaryKey(),
  latestVersion: text("latest_version"),
  minVersion: text("min_version"),
  updateUrl: text("update_url"),
  notes: text("notes"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" })
});
