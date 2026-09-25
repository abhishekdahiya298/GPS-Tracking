import { duePeriod, latestCompletedPeriod, type DuePeriod, type TenantContext } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "./audit";
import { isEmailEnabled, sendEmail, tripSummaryEmail } from "./email";
import { getServerEnv } from "./env";
import { AppError, NotFoundError, TooManyRequestsError, ValidationError } from "./errors";
import { logger } from "./logger";
import { buildTripReport, isValidTimeZone, tripReportCsv } from "./reports";
import { listDevices } from "./vehicles";

/**
 * Scheduled trip-summary emails (reports.manage to configure).
 *
 * Delivery is exactly-once per period: a schedule is claimed with a conditional
 * UPDATE on last_period_key before anything is sent, so concurrent web
 * instances or overlapping ticks can never double-send. Recipients must be
 * members of the schedule's organization, re-checked at send time.
 */

type Meta = { ipAddress: string | null; userAgent: string | null };
type Row = typeof schema.reportSchedules.$inferSelect;

const base = z.object({
  name: z.string().trim().min(1).max(120),
  frequency: z.enum(["daily", "weekly"]),
  timeZone: z.string().max(64).refine(isValidTimeZone, "Unknown time zone"),
  sendHour: z.number().int().min(0).max(23),
  weekday: z.number().int().min(1).max(7).default(1),
  deviceIds: z.array(z.string().uuid()).min(1).max(500).nullable().default(null),
  recipientUserIds: z.array(z.string().uuid()).min(1).max(50),
  attachCsv: z.boolean().default(true),
  active: z.boolean().default(true)
});
export const ScheduleInputSchema = base;
export const SchedulePatchSchema = base.partial().refine((v) => Object.keys(v).length > 0, "Nothing to update");

export interface ScheduleDto {
  id: string;
  name: string;
  frequency: "daily" | "weekly";
  timeZone: string;
  sendHour: number;
  weekday: number;
  deviceIds: string[] | null;
  recipientUserIds: string[];
  attachCsv: boolean;
  active: boolean;
  lastPeriodKey: string | null;
  lastSentAt: string | null;
  lastStatus: string | null;
}

const toDto = (r: Row): ScheduleDto => ({
  id: r.id,
  name: r.name,
  frequency: r.frequency,
  timeZone: r.timeZone,
  sendHour: r.sendHour,
  weekday: r.weekday,
  deviceIds: r.deviceIds ?? null,
  recipientUserIds: r.recipientUserIds,
  attachCsv: r.attachCsv,
  active: r.active,
  lastPeriodKey: r.lastPeriodKey,
  lastSentAt: r.lastSentAt?.toISOString() ?? null,
  lastStatus: r.lastStatus
});

export async function listSchedules(organizationId: string): Promise<ScheduleDto[]> {
  const rows = await getDb()
    .select()
    .from(schema.reportSchedules)
    .where(eq(schema.reportSchedules.organizationId, organizationId))
    .orderBy(asc(schema.reportSchedules.createdAt));
  return rows.map(toDto);
}

/** Devices and recipients must belong to the organization (never trust ids from the client). */
async function assertRefs(organizationId: string, deviceIds: string[] | null | undefined, recipientUserIds: string[] | undefined) {
  const db = getDb();
  if (deviceIds) {
    const found = await db
      .select({ id: schema.gpsDevices.id })
      .from(schema.gpsDevices)
      .where(and(eq(schema.gpsDevices.organizationId, organizationId), inArray(schema.gpsDevices.id, deviceIds)));
    if (found.length !== new Set(deviceIds).size) throw new ValidationError("One or more devices were not found");
  }
  if (recipientUserIds) {
    const found = await db
      .select({ id: schema.memberships.userId })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.organizationId, organizationId), inArray(schema.memberships.userId, recipientUserIds)));
    if (found.length !== new Set(recipientUserIds).size) throw new ValidationError("Recipients must be members of this organization");
  }
}

async function getOwned(organizationId: string, id: string): Promise<Row> {
  const [row] = await getDb()
    .select()
    .from(schema.reportSchedules)
    .where(and(eq(schema.reportSchedules.id, id), eq(schema.reportSchedules.organizationId, organizationId)));
  if (!row) throw new NotFoundError("Report schedule not found");
  return row;
}

export async function createSchedule(ctx: TenantContext, input: z.infer<typeof ScheduleInputSchema>, meta: Meta, now = new Date()) {
  await assertRefs(ctx.organizationId, input.deviceIds, input.recipientUserIds);
  // Start with the *next* period: creating a schedule mid-day must not immediately mail yesterday.
  const current = duePeriod(input, now);
  const [row] = await getDb()
    .insert(schema.reportSchedules)
    .values({ ...input, organizationId: ctx.organizationId, createdBy: ctx.userId, lastPeriodKey: current?.key ?? null })
    .returning({ id: schema.reportSchedules.id });
  await writeAudit({ action: "report_schedule.created", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "report_schedule", targetId: row!.id, metadata: { frequency: input.frequency, recipients: input.recipientUserIds.length }, ...meta });
  return row!.id;
}

export async function updateSchedule(ctx: TenantContext, id: string, patch: z.infer<typeof SchedulePatchSchema>, meta: Meta, now = new Date()) {
  const existing = await getOwned(ctx.organizationId, id);
  await assertRefs(ctx.organizationId, patch.deviceIds, patch.recipientUserIds);
  const next = { ...existing, ...patch };
  const timingChanged = patch.frequency !== undefined || patch.timeZone !== undefined || patch.sendHour !== undefined || patch.weekday !== undefined || (patch.active === true && !existing.active);
  await getDb()
    .update(schema.reportSchedules)
    .set({ ...patch, updatedAt: new Date(), ...(timingChanged ? { lastPeriodKey: duePeriod(next, now)?.key ?? existing.lastPeriodKey } : {}) })
    .where(and(eq(schema.reportSchedules.id, id), eq(schema.reportSchedules.organizationId, ctx.organizationId)));
  await writeAudit({ action: "report_schedule.updated", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "report_schedule", targetId: id, metadata: { fields: Object.keys(patch) }, ...meta });
}

export async function deleteSchedule(ctx: TenantContext, id: string, meta: Meta) {
  await getOwned(ctx.organizationId, id);
  await getDb().delete(schema.reportSchedules).where(and(eq(schema.reportSchedules.id, id), eq(schema.reportSchedules.organizationId, ctx.organizationId)));
  await writeAudit({ action: "report_schedule.deleted", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "report_schedule", targetId: id, ...meta });
}

interface Recipient {
  email: string;
  name: string;
}

async function memberRecipients(organizationId: string, userIds: string[]): Promise<Recipient[]> {
  if (userIds.length === 0) return [];
  return getDb()
    .select({ email: schema.users.email, name: schema.users.name })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(and(eq(schema.memberships.organizationId, organizationId), inArray(schema.memberships.userId, userIds)));
}

/** Builds the summary for one period and emails it. Returns counts; never throws for a single bad recipient. */
async function deliver(s: Row, period: DuePeriod, recipients: Recipient[]) {
  const db = getDb();
  const [org] = await db.select({ name: schema.organizations.name, unitSystem: schema.organizations.unitSystem }).from(schema.organizations).where(eq(schema.organizations.id, s.organizationId));
  const wanted = s.deviceIds ? new Set(s.deviceIds) : null;
  const devices = (await listDevices(s.organizationId)).filter((d) => !wanted || wanted.has(d.id));
  const rows = [];
  const csvParts: string[] = [];
  for (const d of devices) {
    const label = d.vehicle?.name ?? d.name ?? d.model ?? "Device";
    const r = await buildTripReport(s.organizationId, d.id, period.from, period.to, s.timeZone);
    rows.push({ vehicle: label, trips: r.totals.trips, distanceKm: r.totals.distanceKm, drivingMin: r.totals.drivingMin, maxSpeedKph: r.totals.maxSpeedKph });
    if (s.attachCsv) {
      const csv = tripReportCsv(r, label, org?.unitSystem ?? "imperial");
      csvParts.push(csvParts.length === 0 ? csv : csv.slice(csv.indexOf("\r\n") + 2));
    }
  }
  const origin = new URL(getServerEnv().AUTH_URL).origin;
  let sent = 0;
  let failed = 0;
  for (const to of recipients) {
    try {
      await sendEmail(
        tripSummaryEmail(to.email, to.name, {
          orgName: org?.name ?? "Your fleet",
          unitSystem: org?.unitSystem ?? "imperial",
          scheduleName: s.name,
          periodLabel: period.label,
          timeZone: s.timeZone,
          rows,
          reportsUrl: `${origin}/reports`,
          csv: s.attachCsv ? csvParts.join("") : null,
          csvName: `trips-${period.key.replace(/[^0-9a-z-]/gi, "-")}.csv`
        })
      );
      sent++;
    } catch {
      failed++; // sendEmail already logged the failure (without the address)
    }
  }
  return { sent, failed, devices: devices.length };
}

/** One scheduler pass. Safe to run concurrently: each period is claimed atomically. */
export async function runReportSchedules(now = new Date()): Promise<number> {
  if (!isEmailEnabled()) return 0;
  const db = getDb();
  const active = await db.select().from(schema.reportSchedules).where(eq(schema.reportSchedules.active, true));
  let delivered = 0;
  for (const s of active) {
    let period: DuePeriod | null;
    try {
      period = duePeriod(s, now);
    } catch (err) {
      logger.error("reports.schedule_invalid", { scheduleId: s.id }, err);
      continue;
    }
    if (!period || period.key === s.lastPeriodKey) continue;
    const claimed = await db
      .update(schema.reportSchedules)
      .set({ lastPeriodKey: period.key })
      .where(and(eq(schema.reportSchedules.id, s.id), eq(schema.reportSchedules.active, true), s.lastPeriodKey === null ? isNull(schema.reportSchedules.lastPeriodKey) : eq(schema.reportSchedules.lastPeriodKey, s.lastPeriodKey)))
      .returning({ id: schema.reportSchedules.id });
    if (claimed.length === 0) continue; // another instance took it
    try {
      const recipients = await memberRecipients(s.organizationId, s.recipientUserIds);
      const out = await deliver(s, period, recipients);
      const status = out.failed === 0 ? `sent to ${out.sent}` : `sent to ${out.sent}, failed ${out.failed}`;
      await db.update(schema.reportSchedules).set({ lastSentAt: new Date(), lastStatus: status }).where(eq(schema.reportSchedules.id, s.id));
      logger.info("reports.schedule_sent", { scheduleId: s.id, organizationId: s.organizationId, period: period.key, ...out });
      delivered++;
    } catch (err) {
      logger.error("reports.schedule_failed", { scheduleId: s.id, organizationId: s.organizationId, period: period.key }, err);
      await db.update(schema.reportSchedules).set({ lastStatus: "failed (see server logs)" }).where(eq(schema.reportSchedules.id, s.id));
    }
  }
  return delivered;
}


const lastTest = new Map<string, number>();

/** Sends the most recent completed period to the requesting user only. Does not affect the schedule. */
export async function sendTestToSelf(ctx: TenantContext, id: string, meta: Meta, now = new Date()) {
  const s = await getOwned(ctx.organizationId, id);
  const prev = lastTest.get(id) ?? 0;
  if (now.getTime() - prev < 60_000) throw new TooManyRequestsError("Please wait a minute before sending another test");
  if (!isEmailEnabled()) throw new ValidationError("Email is not configured on this server");
  lastTest.set(id, now.getTime());
  const [me] = await getDb().select({ email: schema.users.email, name: schema.users.name }).from(schema.users).where(eq(schema.users.id, ctx.userId));
  const period = latestCompletedPeriod(s, now);
  const out = await deliver(s, period, [me!]);
  await writeAudit({ action: "report_schedule.test_sent", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "report_schedule", targetId: id, metadata: { period: period.key }, ...meta });
  if (out.failed) throw new AppError("EMAIL_FAILED", 502, "The test email could not be sent; try again later");
  return { period: period.label };
}

const g = globalThis as { __rioReportScheduler?: NodeJS.Timeout };
export function startReportScheduler(intervalMs = 5 * 60_000) {
  if (g.__rioReportScheduler) return;
  const tick = () =>
    runReportSchedules().catch((err) => logger.error("reports.scheduler_tick_failed", {}, err));
  g.__rioReportScheduler = setInterval(tick, intervalMs);
  g.__rioReportScheduler.unref?.();
  setTimeout(tick, 30_000).unref?.();
  logger.info("reports.scheduler_started", { intervalSeconds: intervalMs / 1000 });
}
