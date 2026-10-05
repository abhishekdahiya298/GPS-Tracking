import { UNIT_SYSTEMS, type TenantContext } from "@rio-gps/core";
import { TIME_FORMATS, canonicalTimeZone, effectiveTimePrefs, type TimeFormat } from "@rio-gps/core/timezones";
import { getDb, schema } from "@rio-gps/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "./audit";
import { NotFoundError } from "./errors";
import { logger } from "./logger";

type Meta = { ipAddress: string | null; userAgent: string | null };

/** An IANA zone, stored in its canonical spelling ("US/Eastern" → "America/New_York"). */
export const TimeZoneSchema = z
  .string()
  .max(64)
  .transform((v, c) => {
    const tz = canonicalTimeZone(v);
    if (!tz) {
      c.addIssue({ code: z.ZodIssueCode.custom, message: "Unknown time zone" });
      return z.NEVER;
    }
    return tz;
  });

export const OrgSettingsPatchSchema = z
  .object({ unitSystem: z.enum(UNIT_SYSTEMS), timeZone: TimeZoneSchema, timeFormat: z.enum(TIME_FORMATS) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export async function getOrgSettings(organizationId: string) {
  const [o] = await getDb()
    .select({
      name: schema.organizations.name,
      slug: schema.organizations.slug,
      unitSystem: schema.organizations.unitSystem,
      timeZone: schema.organizations.timeZone,
      timeFormat: schema.organizations.timeFormat
    })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId));
  if (!o) throw new NotFoundError("Organization not found");
  return o;
}

/** Tenant is always ctx.organizationId (never from the request). */
export async function updateOrgSettings(ctx: TenantContext, patch: z.infer<typeof OrgSettingsPatchSchema>, meta: Meta) {
  const before = await getOrgSettings(ctx.organizationId);
  await getDb().update(schema.organizations).set({ ...patch, updatedAt: new Date() }).where(eq(schema.organizations.id, ctx.organizationId));
  if (patch.timeZone !== undefined && patch.timeZone !== before.timeZone) {
    // Daily summaries are per local day: rebuild them for the new zone now, not at the next scheduled pass.
    void import("./daily-stats").then((m) => m.refreshDailyStats()).catch((err) => logger.error("stats.rebuild_after_zone_change_failed", { organizationId: ctx.organizationId }, err));
  }
  await writeAudit({
    action: "organization.settings_updated",
    actorUserId: ctx.userId,
    organizationId: ctx.organizationId,
    targetType: "organization",
    targetId: ctx.organizationId,
    metadata: Object.fromEntries(
      (["unitSystem", "timeZone", "timeFormat"] as const).filter((k) => patch[k] !== undefined && patch[k] !== before[k]).map((k) => [k, { from: before[k], to: patch[k] }])
    ),
    ...meta
  });
}

// ---------- personal display preferences ----------

export const UserPrefsPatchSchema = z
  .object({ timeZone: TimeZoneSchema.nullable(), timeFormat: z.enum(TIME_FORMATS).nullable() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

/** The caller's own row only (userId comes from the session, never the request). */
export async function getUserPrefs(userId: string): Promise<{ timeZone: string | null; timeFormat: TimeFormat | null }> {
  const [u] = await getDb().select({ timeZone: schema.users.timeZone, timeFormat: schema.users.timeFormat }).from(schema.users).where(eq(schema.users.id, userId));
  if (!u) throw new NotFoundError("User not found");
  return u;
}

export async function updateUserPrefs(userId: string, organizationId: string | null, patch: z.infer<typeof UserPrefsPatchSchema>, meta: Meta) {
  const before = await getUserPrefs(userId);
  await getDb().update(schema.users).set({ ...patch, updatedAt: new Date() }).where(eq(schema.users.id, userId));
  await writeAudit({
    action: "user.preferences_updated",
    actorUserId: userId,
    organizationId,
    targetType: "user",
    targetId: userId,
    metadata: Object.fromEntries(
      (["timeZone", "timeFormat"] as const).filter((k) => patch[k] !== undefined && patch[k] !== before[k]).map((k) => [k, { from: before[k], to: patch[k] }])
    ),
    ...meta
  });
}

/** Effective display zone/clock for a user acting in an organization (user choice, else org). */
export async function getTimePrefs(organizationId: string, userId: string | null) {
  const db = getDb();
  const [[org], [user]] = await Promise.all([
    db.select({ timeZone: schema.organizations.timeZone, timeFormat: schema.organizations.timeFormat }).from(schema.organizations).where(eq(schema.organizations.id, organizationId)),
    userId ? db.select({ timeZone: schema.users.timeZone, timeFormat: schema.users.timeFormat }).from(schema.users).where(eq(schema.users.id, userId)) : Promise.resolve([])
  ]);
  return effectiveTimePrefs(org ?? { timeZone: "UTC", timeFormat: "12h" }, user ?? null);
}
