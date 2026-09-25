import { maintenanceStatus, type MaintenanceStatus, type TenantContext } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "./audit";
import { isEmailEnabled, maintenanceEmail, sendEmail } from "./email";
import { getServerEnv } from "./env";
import { NotFoundError, ValidationError } from "./errors";
import { logger } from "./logger";

/**
 * Maintenance reminders (maintenance.read / maintenance.write).
 *
 * Distance since the last service is measured from the vehicle's own GPS
 * history (location_history.vehicle_id), counting only moving segments with a
 * plausible speed — the same rules the trip reports use — so parked GPS drift
 * doesn't add kilometres. Emails fire once per state change (due soon →
 * overdue), claimed atomically so several instances never double-send.
 */

type Meta = { ipAddress: string | null; userAgent: string | null };
type Row = typeof schema.maintenanceItems.$inferSelect;

const notFuture = (d: Date) => d.getTime() <= Date.now() + 5 * 60_000;
const itemFields = {
  vehicleId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  intervalKm: z.number().int().min(1).max(1_000_000).nullable().default(null),
  intervalDays: z.number().int().min(1).max(3650).nullable().default(null),
  lastServiceAt: z.coerce.date().refine(notFuture, "Last service can't be in the future"),
  lastServiceOdometerKm: z.number().int().min(0).max(10_000_000).nullable().default(null),
  notifyUserIds: z.array(z.string().uuid()).max(50).default([]),
  note: z.string().trim().max(500).nullable().default(null)
};
export const ItemInputSchema = z.object(itemFields).refine((v) => v.intervalKm !== null || v.intervalDays !== null, "Set a distance interval, a time interval, or both");
export const ItemPatchSchema = z
  .object({
    name: itemFields.name,
    intervalKm: z.number().int().min(1).max(1_000_000).nullable(),
    intervalDays: z.number().int().min(1).max(3650).nullable(),
    notifyUserIds: z.array(z.string().uuid()).max(50),
    note: z.string().trim().max(500).nullable()
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export const ServiceInputSchema = z.object({
  servicedAt: z.coerce.date().refine(notFuture, "Service date can't be in the future").optional(),
  odometerKm: z.number().int().min(0).max(10_000_000).nullable().default(null),
  note: z.string().trim().max(500).nullable().default(null)
});

/** Km driven by a vehicle in [from, to), moving segments only (see module doc). */
export async function kmDriven(organizationId: string, vehicleId: string, from: Date, to: Date): Promise<number> {
  const [row] = await getDb().execute<{ km: number | null }>(sql`
    with pts as (
      select recorded_at t, latitude lat, longitude lon, coalesce(speed_kph, 0) spd, ignition ign,
             lag(recorded_at) over w pt, lag(latitude) over w plat, lag(longitude) over w plon,
             coalesce(lag(speed_kph) over w, 0) pspd, lag(ignition) over w pign
      from location_history
      where organization_id = ${organizationId} and vehicle_id = ${vehicleId}
        and recorded_at >= ${from.toISOString()}::timestamptz and recorded_at < ${to.toISOString()}::timestamptz
      window w as (order by recorded_at)
    ), seg as (
      select 2 * 6371008.8 * asin(least(1, sqrt(
               power(sin(radians(lat - plat) / 2), 2) + cos(radians(plat)) * cos(radians(lat)) * power(sin(radians(lon - plon) / 2), 2)
             ))) m,
             extract(epoch from (t - pt)) s, spd, pspd, ign, pign
      from pts where pt is not null
    )
    select sum(m) / 1000.0 as km from seg
    where s > 0 and s <= 1200 and (m / s) * 3.6 <= 250
      and (ign is true or pign is true or spd >= 5 or pspd >= 5)`);
  return Number(row?.km ?? 0);
}

export interface ItemDto {
  id: string;
  vehicleId: string;
  vehicleName: string;
  name: string;
  intervalKm: number | null;
  intervalDays: number | null;
  lastServiceAt: string;
  lastServiceOdometerKm: number | null;
  notifyUserIds: string[];
  note: string | null;
  status: MaintenanceStatus;
  history: { servicedAt: string; odometerKm: number | null; kmSincePrevious: number | null; note: string | null }[];
}

async function withStatus(r: Row & { vehicleName: string }, now: Date) {
  const km = await kmDriven(r.organizationId, r.vehicleId, r.lastServiceAt, now);
  return maintenanceStatus({ intervalKm: r.intervalKm, intervalDays: r.intervalDays, lastServiceAt: r.lastServiceAt }, km, now);
}

export async function listItems(organizationId: string, now = new Date()): Promise<ItemDto[]> {
  const db = getDb();
  const rows = await db
    .select({ item: schema.maintenanceItems, vehicleName: schema.vehicles.name })
    .from(schema.maintenanceItems)
    .innerJoin(schema.vehicles, and(eq(schema.vehicles.id, schema.maintenanceItems.vehicleId), eq(schema.vehicles.organizationId, organizationId)))
    .where(eq(schema.maintenanceItems.organizationId, organizationId))
    .orderBy(asc(schema.vehicles.name), asc(schema.maintenanceItems.name));
  const ids = rows.map((r) => r.item.id);
  const records = ids.length
    ? await db
        .select()
        .from(schema.maintenanceRecords)
        .where(and(eq(schema.maintenanceRecords.organizationId, organizationId), inArray(schema.maintenanceRecords.itemId, ids)))
        .orderBy(desc(schema.maintenanceRecords.servicedAt))
    : [];
  const out: ItemDto[] = [];
  for (const { item, vehicleName } of rows) {
    out.push({
      id: item.id,
      vehicleId: item.vehicleId,
      vehicleName,
      name: item.name,
      intervalKm: item.intervalKm,
      intervalDays: item.intervalDays,
      lastServiceAt: item.lastServiceAt.toISOString(),
      lastServiceOdometerKm: item.lastServiceOdometerKm,
      notifyUserIds: item.notifyUserIds,
      note: item.note,
      status: await withStatus({ ...item, vehicleName }, now),
      history: records
        .filter((h) => h.itemId === item.id)
        .slice(0, 5)
        .map((h) => ({ servicedAt: h.servicedAt.toISOString(), odometerKm: h.odometerKm, kmSincePrevious: h.kmSincePrevious, note: h.note }))
    });
  }
  return out;
}

async function assertRefs(organizationId: string, vehicleId: string | undefined, userIds: string[] | undefined) {
  const db = getDb();
  if (vehicleId) {
    const [v] = await db.select({ id: schema.vehicles.id }).from(schema.vehicles).where(and(eq(schema.vehicles.id, vehicleId), eq(schema.vehicles.organizationId, organizationId)));
    if (!v) throw new ValidationError("Vehicle not found");
  }
  if (userIds?.length) {
    const found = await db
      .select({ id: schema.memberships.userId })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.organizationId, organizationId), inArray(schema.memberships.userId, userIds)));
    if (found.length !== new Set(userIds).size) throw new ValidationError("People to notify must be members of this organization");
  }
}

async function getOwned(organizationId: string, id: string): Promise<Row> {
  const [row] = await getDb()
    .select()
    .from(schema.maintenanceItems)
    .where(and(eq(schema.maintenanceItems.id, id), eq(schema.maintenanceItems.organizationId, organizationId)));
  if (!row) throw new NotFoundError("Maintenance item not found");
  return row;
}

export async function createItem(ctx: TenantContext, input: z.infer<typeof ItemInputSchema>, meta: Meta) {
  await assertRefs(ctx.organizationId, input.vehicleId, input.notifyUserIds);
  const [row] = await getDb()
    .insert(schema.maintenanceItems)
    .values({ ...input, organizationId: ctx.organizationId })
    .returning({ id: schema.maintenanceItems.id });
  await writeAudit({ action: "maintenance.created", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "maintenance_item", targetId: row!.id, metadata: { vehicleId: input.vehicleId, name: input.name }, ...meta });
  return row!.id;
}

export async function updateItem(ctx: TenantContext, id: string, patch: z.infer<typeof ItemPatchSchema>, meta: Meta) {
  const existing = await getOwned(ctx.organizationId, id);
  const intervalKm = patch.intervalKm !== undefined ? patch.intervalKm : existing.intervalKm;
  const intervalDays = patch.intervalDays !== undefined ? patch.intervalDays : existing.intervalDays;
  if (intervalKm === null && intervalDays === null) throw new ValidationError("Set a distance interval, a time interval, or both");
  await assertRefs(ctx.organizationId, undefined, patch.notifyUserIds);
  const intervalsChanged = patch.intervalKm !== undefined || patch.intervalDays !== undefined;
  await getDb()
    .update(schema.maintenanceItems)
    .set({ ...patch, updatedAt: new Date(), ...(intervalsChanged ? { notifiedState: null } : {}) })
    .where(and(eq(schema.maintenanceItems.id, id), eq(schema.maintenanceItems.organizationId, ctx.organizationId)));
  await writeAudit({ action: "maintenance.updated", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "maintenance_item", targetId: id, metadata: { fields: Object.keys(patch) }, ...meta });
}

export async function deleteItem(ctx: TenantContext, id: string, meta: Meta) {
  await getOwned(ctx.organizationId, id);
  await getDb().delete(schema.maintenanceItems).where(and(eq(schema.maintenanceItems.id, id), eq(schema.maintenanceItems.organizationId, ctx.organizationId)));
  await writeAudit({ action: "maintenance.deleted", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "maintenance_item", targetId: id, ...meta });
}

/** "Mark serviced": records the service and restarts the interval. */
export async function recordService(ctx: TenantContext, id: string, input: z.infer<typeof ServiceInputSchema>, meta: Meta) {
  const item = await getOwned(ctx.organizationId, id);
  const servicedAt = input.servicedAt ?? new Date();
  if (servicedAt < item.lastServiceAt) throw new ValidationError("Service date is before the previous service");
  const km = Math.round(await kmDriven(ctx.organizationId, item.vehicleId, item.lastServiceAt, servicedAt));
  await getDb().transaction(async (tx) => {
    await tx.insert(schema.maintenanceRecords).values({
      organizationId: ctx.organizationId,
      itemId: id,
      vehicleId: item.vehicleId,
      servicedAt,
      odometerKm: input.odometerKm,
      kmSincePrevious: km,
      note: input.note,
      createdBy: ctx.userId
    });
    await tx
      .update(schema.maintenanceItems)
      .set({ lastServiceAt: servicedAt, lastServiceOdometerKm: input.odometerKm, notifiedState: null, updatedAt: new Date() })
      .where(and(eq(schema.maintenanceItems.id, id), eq(schema.maintenanceItems.organizationId, ctx.organizationId)));
  });
  await writeAudit({ action: "maintenance.serviced", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "maintenance_item", targetId: id, metadata: { kmSincePrevious: km }, ...meta });
}

/** Counts for the dashboard badge. */
export async function dueCounts(organizationId: string, now = new Date()) {
  const items = await listItems(organizationId, now);
  return { overdue: items.filter((i) => i.status.state === "overdue").length, dueSoon: items.filter((i) => i.status.state === "due_soon").length };
}

/** Scheduler pass: email on each transition into due_soon / overdue. */
export async function runMaintenanceCheck(now = new Date()): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ item: schema.maintenanceItems, vehicleName: schema.vehicles.name, orgName: schema.organizations.name, unitSystem: schema.organizations.unitSystem })
    .from(schema.maintenanceItems)
    .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.maintenanceItems.vehicleId))
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.maintenanceItems.organizationId));
  let notified = 0;
  for (const { item, vehicleName, orgName, unitSystem } of rows) {
    try {
      const status = await withStatus({ ...item, vehicleName }, now);
      const target = status.state === "ok" ? null : status.state;
      if (target === item.notifiedState) continue;
      if (target !== null && !isEmailEnabled()) continue; // keep the transition pending until email works
      // Claim the transition atomically (compare-and-set on notified_state).
      const claimed = await db
        .update(schema.maintenanceItems)
        .set({ notifiedState: target })
        .where(
          and(
            eq(schema.maintenanceItems.id, item.id),
            item.notifiedState === null ? isNull(schema.maintenanceItems.notifiedState) : eq(schema.maintenanceItems.notifiedState, item.notifiedState)
          )
        )
        .returning({ id: schema.maintenanceItems.id });
      if (claimed.length === 0 || target === null || item.notifyUserIds.length === 0) continue;
      const recipients = await db
        .select({ email: schema.users.email, name: schema.users.name })
        .from(schema.memberships)
        .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
        .where(and(eq(schema.memberships.organizationId, item.organizationId), inArray(schema.memberships.userId, item.notifyUserIds)));
      const url = `${new URL(getServerEnv().AUTH_URL).origin}/maintenance`;
      for (const r of recipients) {
        try {
          await sendEmail(maintenanceEmail(r.email, r.name, { orgName, vehicleName, itemName: item.name, state: target, status }, url, unitSystem));
        } catch {
          // logged by sendEmail
        }
      }
      notified++;
      logger.info("maintenance.notified", { itemId: item.id, organizationId: item.organizationId, state: target, recipients: recipients.length });
    } catch (err) {
      logger.error("maintenance.check_failed", { itemId: item.id }, err);
    }
  }
  return notified;
}

const g = globalThis as { __rioMaintenanceScheduler?: NodeJS.Timeout };
export function startMaintenanceScheduler(intervalMs = 15 * 60_000) {
  if (g.__rioMaintenanceScheduler) return;
  const tick = () => runMaintenanceCheck().catch((err) => logger.error("maintenance.scheduler_tick_failed", {}, err));
  g.__rioMaintenanceScheduler = setInterval(tick, intervalMs);
  g.__rioMaintenanceScheduler.unref?.();
  setTimeout(tick, 60_000).unref?.();
  logger.info("maintenance.scheduler_started", { intervalSeconds: intervalMs / 1000 });
}
