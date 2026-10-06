import { RENEWAL_TYPES, renewalStatus, type RenewalStatus, type RenewalType, type TenantContext } from "@rio-gps/core";
import { canonicalTimeZone, dateFormatter } from "@rio-gps/core/timezones";
import { getDb, schema } from "@rio-gps/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "./audit";
import { isEmailEnabled, renewalEmail, sendEmail } from "./email";
import { getServerEnv } from "./env";
import { NotFoundError, ValidationError } from "./errors";
import { logger } from "./logger";

/**
 * Renewal reminders (maintenance.read / maintenance.write): registration, insurance,
 * inspection, permits… due on a calendar day in the organization's time zone. Emails fire
 * once per state change (due soon → overdue), claimed atomically like maintenance.
 */
type Meta = { ipAddress: string | null; userAgent: string | null };
type Row = typeof schema.renewalReminders.$inferSelect;

const Day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-31")
  .refine((d) => !Number.isNaN(Date.parse(`${d}T12:00:00Z`)) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d, "Not a real date")
  .refine((d) => d >= "2000-01-01" && d <= "2100-12-31", "Date out of range");
const fields = {
  vehicleId: z.string().uuid().nullable().default(null),
  type: z.enum(RENEWAL_TYPES),
  title: z.string().trim().min(1, "Give it a name").max(120),
  dueDate: Day,
  remindDays: z.number().int().min(0).max(365).default(30),
  notifyUserIds: z.array(z.string().uuid()).max(50).default([]),
  note: z.string().trim().max(500).nullable().default(null)
};
export const RenewalInputSchema = z.object(fields);
export const RenewalPatchSchema = z
  .object({ ...fields, vehicleId: z.string().uuid().nullable(), remindDays: z.number().int().min(0).max(365), notifyUserIds: z.array(z.string().uuid()).max(50), note: z.string().trim().max(500).nullable() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export const RenewInputSchema = z.object({ dueDate: Day });

export interface RenewalDto {
  id: string;
  vehicleId: string | null;
  vehicleName: string | null;
  type: RenewalType;
  title: string;
  dueDate: string;
  remindDays: number;
  notifyUserIds: string[];
  note: string | null;
  lastRenewedAt: string | null;
  status: RenewalStatus;
}

async function orgToday(organizationId: string, now: Date): Promise<string> {
  const [o] = await getDb().select({ timeZone: schema.organizations.timeZone }).from(schema.organizations).where(eq(schema.organizations.id, organizationId));
  return dateFormatter(canonicalTimeZone(o?.timeZone) ?? "UTC").dayKey(now);
}

const toDto = (r: Row, vehicleName: string | null, today: string): RenewalDto => ({
  id: r.id,
  vehicleId: r.vehicleId,
  vehicleName,
  type: (RENEWAL_TYPES as readonly string[]).includes(r.type) ? (r.type as RenewalType) : "other",
  title: r.title,
  dueDate: r.dueDate,
  remindDays: r.remindDays,
  notifyUserIds: r.notifyUserIds,
  note: r.note,
  lastRenewedAt: r.lastRenewedAt?.toISOString() ?? null,
  status: renewalStatus(r.dueDate, r.remindDays, today)
});

/** Soonest due first. */
export async function listRenewals(organizationId: string, now = new Date()): Promise<RenewalDto[]> {
  const t = schema.renewalReminders;
  const [today, rows] = await Promise.all([
    orgToday(organizationId, now),
    getDb()
      .select({ r: t, vehicleName: schema.vehicles.name })
      .from(t)
      .leftJoin(schema.vehicles, and(eq(schema.vehicles.id, t.vehicleId), eq(schema.vehicles.organizationId, organizationId)))
      .where(eq(t.organizationId, organizationId))
      .orderBy(asc(t.dueDate), asc(t.title))
  ]);
  return rows.map((x) => toDto(x.r, x.vehicleName, today));
}

export async function renewalCounts(organizationId: string, now = new Date()) {
  const items = await listRenewals(organizationId, now);
  return { overdue: items.filter((i) => i.status.state === "overdue").length, dueSoon: items.filter((i) => i.status.state === "due_soon").length };
}

/** Vehicle and recipients must belong to the organization (never trusted from the browser). */
async function assertOwned(organizationId: string, vehicleId: string | null | undefined, userIds: string[] | undefined) {
  const db = getDb();
  if (vehicleId) {
    const [v] = await db.select({ id: schema.vehicles.id }).from(schema.vehicles).where(and(eq(schema.vehicles.id, vehicleId), eq(schema.vehicles.organizationId, organizationId)));
    if (!v) throw new ValidationError("Vehicle not found");
  }
  if (userIds?.length) {
    const unique = [...new Set(userIds)];
    const rows = await db.select({ id: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.organizationId, organizationId), inArray(schema.memberships.userId, unique)));
    if (rows.length !== unique.length) throw new ValidationError("One or more recipients are not members of this organization");
  }
}

export async function createRenewal(ctx: TenantContext, input: z.infer<typeof RenewalInputSchema>, meta: Meta): Promise<string> {
  await assertOwned(ctx.organizationId, input.vehicleId, input.notifyUserIds);
  const [r] = await getDb()
    .insert(schema.renewalReminders)
    .values({ organizationId: ctx.organizationId, ...input, notifyUserIds: [...new Set(input.notifyUserIds)] })
    .returning({ id: schema.renewalReminders.id });
  await writeAudit({ action: "renewal.created", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "renewal", targetId: r!.id, metadata: { type: input.type, title: input.title, dueDate: input.dueDate }, ...meta });
  return r!.id;
}

export async function updateRenewal(ctx: TenantContext, id: string, patch: z.infer<typeof RenewalPatchSchema>, meta: Meta): Promise<void> {
  await assertOwned(ctx.organizationId, patch.vehicleId, patch.notifyUserIds);
  const t = schema.renewalReminders;
  // A new date or reminder window can change the state: let the next pass notify again.
  const timing = patch.dueDate !== undefined || patch.remindDays !== undefined;
  const [r] = await getDb()
    .update(t)
    .set({ ...patch, ...(patch.notifyUserIds ? { notifyUserIds: [...new Set(patch.notifyUserIds)] } : {}), ...(timing ? { notifiedState: null } : {}), updatedAt: new Date() })
    .where(and(eq(t.id, id), eq(t.organizationId, ctx.organizationId)))
    .returning({ id: t.id });
  if (!r) throw new NotFoundError("Renewal not found");
  await writeAudit({ action: "renewal.updated", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "renewal", targetId: id, metadata: { fields: Object.keys(patch) }, ...meta });
}

/** Mark as renewed: the next due date replaces the old one and reminders start over. */
export async function renewRenewal(ctx: TenantContext, id: string, input: z.infer<typeof RenewInputSchema>, meta: Meta): Promise<void> {
  const t = schema.renewalReminders;
  const [before] = await getDb().select({ dueDate: t.dueDate }).from(t).where(and(eq(t.id, id), eq(t.organizationId, ctx.organizationId)));
  if (!before) throw new NotFoundError("Renewal not found");
  if (input.dueDate <= before.dueDate) throw new ValidationError("The new due date must be after the current one");
  await getDb()
    .update(t)
    .set({ dueDate: input.dueDate, notifiedState: null, lastRenewedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(t.id, id), eq(t.organizationId, ctx.organizationId)));
  await writeAudit({ action: "renewal.renewed", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "renewal", targetId: id, metadata: { from: before.dueDate, to: input.dueDate }, ...meta });
}

export async function deleteRenewal(ctx: TenantContext, id: string, meta: Meta): Promise<void> {
  const t = schema.renewalReminders;
  const [r] = await getDb().delete(t).where(and(eq(t.id, id), eq(t.organizationId, ctx.organizationId))).returning({ title: t.title });
  if (!r) throw new NotFoundError("Renewal not found");
  await writeAudit({ action: "renewal.deleted", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "renewal", targetId: id, metadata: { title: r.title }, ...meta });
}

/** Scheduler pass: email on each transition into due_soon / overdue. Returns the number notified. */
export async function runRenewalCheck(now = new Date()): Promise<number> {
  const db = getDb();
  const t = schema.renewalReminders;
  const rows = await db
    .select({ r: t, vehicleName: schema.vehicles.name, orgName: schema.organizations.name, timeZone: schema.organizations.timeZone })
    .from(t)
    .innerJoin(schema.organizations, eq(schema.organizations.id, t.organizationId))
    .leftJoin(schema.vehicles, eq(schema.vehicles.id, t.vehicleId));
  let notified = 0;
  for (const { r, vehicleName, orgName, timeZone } of rows) {
    try {
      const tz = canonicalTimeZone(timeZone) ?? "UTC";
      const status = renewalStatus(r.dueDate, r.remindDays, dateFormatter(tz).dayKey(now));
      const target = status.state === "ok" ? null : status.state;
      if (target === r.notifiedState) continue;
      if (target !== null && !isEmailEnabled()) continue; // keep the transition pending until email works
      // Claim the transition atomically (compare-and-set on notified_state).
      const claimed = await db
        .update(t)
        .set({ notifiedState: target })
        .where(and(eq(t.id, r.id), r.notifiedState === null ? isNull(t.notifiedState) : eq(t.notifiedState, r.notifiedState)))
        .returning({ id: t.id });
      if (claimed.length === 0 || target === null || r.notifyUserIds.length === 0) continue;
      const recipients = await db
        .select({ email: schema.users.email, name: schema.users.name })
        .from(schema.memberships)
        .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
        .where(and(eq(schema.memberships.organizationId, r.organizationId), inArray(schema.memberships.userId, r.notifyUserIds)));
      const url = `${new URL(getServerEnv().AUTH_URL).origin}/maintenance/renewals`;
      for (const p of recipients) {
        try {
          await sendEmail(renewalEmail(p.email, p.name, { orgName, vehicleName, title: r.title, type: toDto(r, vehicleName, r.dueDate).type, state: target, dueDate: r.dueDate, daysRemaining: status.daysRemaining }, url));
        } catch {
          // logged by sendEmail
        }
      }
      notified++;
      logger.info("renewals.notified", { renewalId: r.id, organizationId: r.organizationId, state: target, recipients: recipients.length });
    } catch (err) {
      logger.error("renewals.check_failed", { renewalId: r.id }, err);
    }
  }
  return notified;
}
