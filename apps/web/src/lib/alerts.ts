import {
  ALERT_TYPES,
  alertChannel,
  evaluateOffline,
  evaluatePosition,
  insideGeofence,
  type AlertState,
  type AlertType,
  type GeofenceShape,
  type TenantContext
} from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "./audit";
import { alertEmail, isEmailEnabled, sendEmail } from "./email";
import { getServerEnv } from "./env";
import { NotFoundError, ValidationError } from "./errors";
import { logger } from "./logger";
import { getReadyRedisPublisher } from "./redis";

/**
 * Geofences, alert rules and alert events. Every read/write is scoped to the
 * caller's organization; ids from the client are only matched inside it.
 */

type Meta = { ipAddress: string | null; userAgent: string | null };
type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

const lon = z.number().gte(-180).lte(180);
const lat = z.number().gte(-90).lte(90);

export const GeofenceInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("circle"),
    name: z.string().trim().min(1).max(120),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    center: z.tuple([lon, lat]),
    radiusM: z.number().int().min(20).max(50_000)
  }),
  z.object({
    kind: z.literal("polygon"),
    name: z.string().trim().min(1).max(120),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    ring: z.array(z.tuple([lon, lat])).min(3).max(200)
  })
]);
export const GeofencePatchSchema = z
  .object({ name: z.string().trim().min(1).max(120).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const AlertRuleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    type: z.enum(ALERT_TYPES),
    vehicleId: z.string().uuid().nullable().optional(),
    geofenceId: z.string().uuid().nullable().optional(),
    speedKph: z.number().int().min(5).max(300).nullable().optional(),
    offlineMinutes: z.number().int().min(5).max(10_080).nullable().optional(),
    notifyEmail: z.boolean().default(false),
    active: z.boolean().default(true)
  })
  .superRefine((r, ctx) => {
    if ((r.type === "geofence_enter" || r.type === "geofence_exit") && !r.geofenceId)
      ctx.addIssue({ code: "custom", path: ["geofenceId"], message: "required for geofence rules" });
    if (r.type === "speeding" && !r.speedKph) ctx.addIssue({ code: "custom", path: ["speedKph"], message: "required for speeding rules" });
    if (r.type === "device_offline" && !r.offlineMinutes)
      ctx.addIssue({ code: "custom", path: ["offlineMinutes"], message: "required for offline rules" });
  });
export const AlertRulePatchSchema = z
  .object({ name: z.string().trim().min(1).max(120).optional(), active: z.boolean().optional(), notifyEmail: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

// ---------- geofences ----------

export interface GeofenceDto {
  id: string;
  name: string;
  color: string;
  shape: GeofenceShape;
}

function toShape(g: typeof schema.geofences.$inferSelect): GeofenceShape {
  return g.kind === "circle"
    ? { kind: "circle", center: [g.centerLon!, g.centerLat!], radiusM: g.radiusM! }
    : { kind: "polygon", ring: g.polygon ?? [] };
}

export async function listGeofences(organizationId: string): Promise<GeofenceDto[]> {
  const rows = await getDb().select().from(schema.geofences).where(eq(schema.geofences.organizationId, organizationId)).orderBy(schema.geofences.name);
  return rows.map((g) => ({ id: g.id, name: g.name, color: g.color, shape: toShape(g) }));
}

export async function createGeofence(ctx: TenantContext, input: z.infer<typeof GeofenceInputSchema>, meta: Meta) {
  const [g] = await getDb()
    .insert(schema.geofences)
    .values({
      organizationId: ctx.organizationId,
      name: input.name,
      kind: input.kind,
      color: input.color ?? "#3056d3",
      ...(input.kind === "circle"
        ? { centerLon: input.center[0], centerLat: input.center[1], radiusM: input.radiusM }
        : { polygon: input.ring })
    })
    .returning();
  await writeAudit({ action: "geofence.created", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "geofence", targetId: g!.id, metadata: { name: g!.name, kind: g!.kind }, ...meta });
  return { id: g!.id, name: g!.name, color: g!.color, shape: toShape(g!) } satisfies GeofenceDto;
}

export async function updateGeofence(ctx: TenantContext, id: string, patch: z.infer<typeof GeofencePatchSchema>, meta: Meta) {
  const [g] = await getDb()
    .update(schema.geofences)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(schema.geofences.id, id), eq(schema.geofences.organizationId, ctx.organizationId)))
    .returning();
  if (!g) throw new NotFoundError("Geofence not found");
  await writeAudit({ action: "geofence.updated", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "geofence", targetId: id, metadata: { fields: Object.keys(patch) }, ...meta });
}

/** Deleting a geofence also deletes the rules that use it (FK cascade); events keep their rule name. */
export async function deleteGeofence(ctx: TenantContext, id: string, meta: Meta) {
  const del = await getDb()
    .delete(schema.geofences)
    .where(and(eq(schema.geofences.id, id), eq(schema.geofences.organizationId, ctx.organizationId)))
    .returning({ id: schema.geofences.id });
  if (del.length === 0) throw new NotFoundError("Geofence not found");
  await writeAudit({ action: "geofence.deleted", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "geofence", targetId: id, ...meta });
}

// ---------- rules ----------

export interface AlertRuleDto {
  id: string;
  name: string;
  type: AlertType;
  vehicleId: string | null;
  geofenceId: string | null;
  speedKph: number | null;
  offlineMinutes: number | null;
  notifyEmail: boolean;
  active: boolean;
}

export async function listRules(organizationId: string): Promise<AlertRuleDto[]> {
  const rows = await getDb().select().from(schema.alertRules).where(eq(schema.alertRules.organizationId, organizationId)).orderBy(schema.alertRules.name);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    vehicleId: r.vehicleId,
    geofenceId: r.geofenceId,
    speedKph: r.speedKph,
    offlineMinutes: r.offlineMinutes,
    notifyEmail: r.notifyEmail,
    active: r.active
  }));
}

export async function createRule(ctx: TenantContext, input: z.infer<typeof AlertRuleInputSchema>, meta: Meta) {
  const db = getDb();
  const isFence = input.type === "geofence_enter" || input.type === "geofence_exit";
  if (input.vehicleId) {
    const [v] = await db.select({ id: schema.vehicles.id }).from(schema.vehicles).where(and(eq(schema.vehicles.id, input.vehicleId), eq(schema.vehicles.organizationId, ctx.organizationId)));
    if (!v) throw new NotFoundError("Vehicle not found");
  }
  if (isFence) {
    const [g] = await db.select({ id: schema.geofences.id }).from(schema.geofences).where(and(eq(schema.geofences.id, input.geofenceId!), eq(schema.geofences.organizationId, ctx.organizationId)));
    if (!g) throw new NotFoundError("Geofence not found");
  }
  const [r] = await db
    .insert(schema.alertRules)
    .values({
      organizationId: ctx.organizationId,
      name: input.name,
      type: input.type,
      vehicleId: input.vehicleId ?? null,
      geofenceId: isFence ? input.geofenceId! : null,
      speedKph: input.type === "speeding" ? input.speedKph! : null,
      offlineMinutes: input.type === "device_offline" ? input.offlineMinutes! : null,
      notifyEmail: input.notifyEmail,
      active: input.active
    })
    .returning({ id: schema.alertRules.id });
  await writeAudit({ action: "alert_rule.created", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "alert_rule", targetId: r!.id, metadata: { type: input.type }, ...meta });
  return r!.id;
}

export async function updateRule(ctx: TenantContext, id: string, patch: z.infer<typeof AlertRulePatchSchema>, meta: Meta) {
  const [r] = await getDb()
    .update(schema.alertRules)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(schema.alertRules.id, id), eq(schema.alertRules.organizationId, ctx.organizationId)))
    .returning({ id: schema.alertRules.id });
  if (!r) throw new NotFoundError("Alert rule not found");
  await writeAudit({ action: "alert_rule.updated", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "alert_rule", targetId: id, metadata: patch, ...meta });
}

export async function deleteRule(ctx: TenantContext, id: string, meta: Meta) {
  const del = await getDb()
    .delete(schema.alertRules)
    .where(and(eq(schema.alertRules.id, id), eq(schema.alertRules.organizationId, ctx.organizationId)))
    .returning({ id: schema.alertRules.id });
  if (del.length === 0) throw new NotFoundError("Alert rule not found");
  await writeAudit({ action: "alert_rule.deleted", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "alert_rule", targetId: id, ...meta });
}

// ---------- events ----------

export interface AlertEventDto {
  id: number;
  type: AlertType;
  ruleName: string;
  deviceId: string | null;
  vehicleId: string | null;
  vehicleName: string | null;
  occurredAt: string;
  latitude: number | null;
  longitude: number | null;
  details: Record<string, unknown> | null;
  acknowledgedAt: string | null;
}

export async function listEvents(organizationId: string, opts: { limit: number; unacknowledgedOnly: boolean; beforeId?: number; vehicleId?: string }): Promise<AlertEventDto[]> {
  const e = schema.alertEvents;
  const conds = [eq(e.organizationId, organizationId)];
  if (opts.unacknowledgedOnly) conds.push(isNull(e.acknowledgedAt));
  if (opts.beforeId) conds.push(lt(e.id, opts.beforeId));
  if (opts.vehicleId) conds.push(eq(e.vehicleId, opts.vehicleId));
  const rows = await getDb()
    .select({ ev: e, vehicleName: schema.vehicles.name })
    .from(e)
    .leftJoin(schema.vehicles, and(eq(schema.vehicles.id, e.vehicleId), eq(schema.vehicles.organizationId, organizationId)))
    .where(and(...conds))
    .orderBy(desc(e.id))
    .limit(opts.limit);
  return rows.map(({ ev, vehicleName }) => toEventDto(ev, vehicleName));
}

function toEventDto(ev: typeof schema.alertEvents.$inferSelect, vehicleName: string | null): AlertEventDto {
  return {
    id: ev.id,
    type: ev.type,
    ruleName: ev.ruleName,
    deviceId: ev.deviceId,
    vehicleId: ev.vehicleId,
    vehicleName,
    occurredAt: ev.occurredAt.toISOString(),
    latitude: ev.latitude,
    longitude: ev.longitude,
    details: ev.details,
    acknowledgedAt: ev.acknowledgedAt?.toISOString() ?? null
  };
}

export async function countUnacknowledged(organizationId: string): Promise<number> {
  const [r] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.alertEvents)
    .where(and(eq(schema.alertEvents.organizationId, organizationId), isNull(schema.alertEvents.acknowledgedAt)));
  return r?.n ?? 0;
}

export async function acknowledgeEvents(ctx: TenantContext, ids: number[] | "all") {
  const e = schema.alertEvents;
  const conds = [eq(e.organizationId, ctx.organizationId), isNull(e.acknowledgedAt)];
  if (ids !== "all") {
    if (ids.length === 0) throw new ValidationError("No alerts given");
    conds.push(inArray(e.id, ids));
  }
  const rows = await getDb().update(e).set({ acknowledgedAt: new Date(), acknowledgedBy: ctx.userId }).where(and(...conds)).returning({ id: e.id });
  return rows.length;
}

// ---------- evaluation ----------

interface FiredEvent {
  row: typeof schema.alertEvents.$inferSelect;
  rule: { id: string; name: string; notifyEmail: boolean };
}

async function lockState(tx: Tx, ruleId: string, deviceId: string): Promise<AlertState> {
  await tx.insert(schema.alertRuleState).values({ ruleId, deviceId }).onConflictDoNothing();
  const [row] = await tx
    .select({ state: schema.alertRuleState.state })
    .from(schema.alertRuleState)
    .where(and(eq(schema.alertRuleState.ruleId, ruleId), eq(schema.alertRuleState.deviceId, deviceId)))
    .for("update");
  return (row?.state ?? {}) as AlertState;
}

async function saveState(tx: Tx, ruleId: string, deviceId: string, state: AlertState) {
  await tx
    .update(schema.alertRuleState)
    .set({ state: state as Record<string, unknown>, updatedAt: new Date() })
    .where(and(eq(schema.alertRuleState.ruleId, ruleId), eq(schema.alertRuleState.deviceId, deviceId)));
}

export interface EvaluatedPoint {
  latitude: number;
  longitude: number;
  speedKph: number | null;
  ignition: boolean | null;
  recordedAt: Date;
}

/**
 * Called after a newer position is committed. Never throws into the ingest
 * path: failures are logged and the position stays stored.
 */
export async function evaluateAlertsForPosition(device: { id: string; organizationId: string }, point: EvaluatedPoint): Promise<number> {
  try {
    const db = getDb();
    const [assignment] = await db
      .select({ vehicleId: schema.deviceAssignments.vehicleId })
      .from(schema.deviceAssignments)
      .where(and(eq(schema.deviceAssignments.deviceId, device.id), isNull(schema.deviceAssignments.unassignedAt)))
      .limit(1);
    const vehicleId = assignment?.vehicleId ?? null;
    const rules = await db
      .select({ rule: schema.alertRules, fence: schema.geofences })
      .from(schema.alertRules)
      .leftJoin(schema.geofences, eq(schema.geofences.id, schema.alertRules.geofenceId))
      .where(
        and(
          eq(schema.alertRules.organizationId, device.organizationId),
          eq(schema.alertRules.active, true),
          vehicleId ? or(isNull(schema.alertRules.vehicleId), eq(schema.alertRules.vehicleId, vehicleId)) : isNull(schema.alertRules.vehicleId)
        )
      );
    if (rules.length === 0) return 0;

    const fired: FiredEvent[] = [];
    for (const { rule, fence } of rules) {
      const inside = fence ? insideGeofence([point.longitude, point.latitude], toShape(fence)) : undefined;
      const ev = await db.transaction(async (tx) => {
        const prev = await lockState(tx, rule.id, device.id);
        const r = evaluatePosition(rule.type, { speedKph: rule.speedKph ?? undefined }, prev, { speedKph: point.speedKph, ignition: point.ignition, inside });
        await saveState(tx, rule.id, device.id, r.next);
        if (!r.fire) return null;
        const [row] = await tx
          .insert(schema.alertEvents)
          .values({
            organizationId: device.organizationId,
            ruleId: rule.id,
            ruleName: rule.name,
            type: rule.type,
            deviceId: device.id,
            vehicleId,
            occurredAt: point.recordedAt,
            latitude: point.latitude,
            longitude: point.longitude,
            details: { ...r.details, ...(fence ? { geofence: fence.name } : {}) }
          })
          .returning();
        return row!;
      });
      if (ev) fired.push({ row: ev, rule: { id: rule.id, name: rule.name, notifyEmail: rule.notifyEmail } });
    }
    await deliver(device.organizationId, fired);
    return fired.length;
  } catch (err) {
    logger.error("alerts.evaluate_failed", { deviceId: device.id, organizationId: device.organizationId }, err);
    return 0;
  }
}

const OFFLINE_LOCK_KEY = 482_133_901; // arbitrary, stable

/** Periodic offline check. A transaction-scoped advisory lock keeps it single-runner. */
export async function runOfflineCheck(now = new Date()): Promise<number> {
  const db = getDb();
  const firedByOrg = new Map<string, FiredEvent[]>();
  const ran = await db.transaction(async (tx) => {
    const [lock] = await tx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(${OFFLINE_LOCK_KEY}) as ok`);
    if (!lock?.ok) return false;
    const rules = await tx.select().from(schema.alertRules).where(and(eq(schema.alertRules.type, "device_offline"), eq(schema.alertRules.active, true)));
    for (const rule of rules) {
      const devices = await tx
        .select({ id: schema.gpsDevices.id, lastSeenAt: schema.gpsDevices.lastSeenAt, vehicleId: schema.deviceAssignments.vehicleId })
        .from(schema.gpsDevices)
        .leftJoin(schema.deviceAssignments, and(eq(schema.deviceAssignments.deviceId, schema.gpsDevices.id), isNull(schema.deviceAssignments.unassignedAt)))
        .where(
          and(
            eq(schema.gpsDevices.organizationId, rule.organizationId),
            eq(schema.gpsDevices.status, "active"),
            rule.vehicleId ? eq(schema.deviceAssignments.vehicleId, rule.vehicleId) : undefined
          )
        );
      for (const d of devices) {
        const prev = await lockState(tx, rule.id, d.id);
        const r = evaluateOffline(prev, d.lastSeenAt, now, rule.offlineMinutes ?? 60);
        await saveState(tx, rule.id, d.id, r.next);
        if (!r.fire) continue;
        const [row] = await tx
          .insert(schema.alertEvents)
          .values({ organizationId: rule.organizationId, ruleId: rule.id, ruleName: rule.name, type: rule.type, deviceId: d.id, vehicleId: d.vehicleId ?? null, occurredAt: now, details: r.details })
          .returning();
        const list = firedByOrg.get(rule.organizationId) ?? [];
        list.push({ row: row!, rule: { id: rule.id, name: rule.name, notifyEmail: rule.notifyEmail } });
        firedByOrg.set(rule.organizationId, list);
      }
    }
    return true;
  });
  if (!ran) return 0;
  let n = 0;
  for (const [org, list] of firedByOrg) {
    await deliver(org, list);
    n += list.length;
  }
  return n;
}

const EMAIL_THROTTLE_MS = 5 * 60_000;

/** After commit: live push to the org's SSE channel, then (throttled) email. */
async function deliver(organizationId: string, fired: FiredEvent[]) {
  if (fired.length === 0) return;
  const db = getDb();
  const vehicleIds = [...new Set(fired.map((f) => f.row.vehicleId).filter((v): v is string => Boolean(v)))];
  const names = vehicleIds.length
    ? new Map((await db.select({ id: schema.vehicles.id, name: schema.vehicles.name }).from(schema.vehicles).where(inArray(schema.vehicles.id, vehicleIds))).map((v) => [v.id, v.name]))
    : new Map<string, string>();

  try {
    const pub = await getReadyRedisPublisher();
    for (const f of fired) await pub.publish(alertChannel(organizationId), JSON.stringify(toEventDto(f.row, f.row.vehicleId ? (names.get(f.row.vehicleId) ?? null) : null)));
  } catch (err) {
    logger.error("alerts.publish_failed", { organizationId }, err);
  }

  const toEmail = fired.filter((f) => f.rule.notifyEmail);
  if (toEmail.length === 0 || !isEmailEnabled()) return;
  try {
    const recipients = await db
      .select({ email: schema.users.email, name: schema.users.name })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(and(eq(schema.memberships.organizationId, organizationId), inArray(schema.memberships.role, ["ORG_ADMIN", "FLEET_MANAGER", "DISPATCHER"])));
    if (recipients.length === 0) return;
    const appUrl = new URL(getServerEnv().AUTH_URL).origin;
    const [org] = await db.select({ unitSystem: schema.organizations.unitSystem }).from(schema.organizations).where(eq(schema.organizations.id, organizationId));
    for (const f of toEmail) {
      // Throttle per (rule, device) using the rule state row.
      const allowed = await db.transaction(async (tx) => {
        if (!f.row.deviceId) return true;
        const st = await lockState(tx, f.rule.id, f.row.deviceId);
        if (st.lastEmailAt && Date.now() - Date.parse(st.lastEmailAt) < EMAIL_THROTTLE_MS) return false;
        await saveState(tx, f.rule.id, f.row.deviceId, { ...st, lastEmailAt: new Date().toISOString() });
        return true;
      });
      if (!allowed) {
        logger.info("alerts.email_throttled", { ruleId: f.rule.id });
        continue;
      }
      const dto = toEventDto(f.row, f.row.vehicleId ? (names.get(f.row.vehicleId) ?? null) : null);
      for (const r of recipients) {
        await sendEmail(alertEmail(r.email, r.name, dto, `${appUrl}/alerts`, org?.unitSystem ?? "imperial")).catch(() => undefined);
      }
    }
  } catch (err) {
    logger.error("alerts.email_failed", { organizationId }, err);
  }
}

// ---------- scheduler ----------

const g = globalThis as unknown as { __rioAlertScheduler?: NodeJS.Timeout };

export function startAlertScheduler(intervalMs = 60_000) {
  if (g.__rioAlertScheduler) return;
  const tick = () =>
    runOfflineCheck().then(
      (n) => n > 0 && logger.info("alerts.offline_check", { fired: n }),
      (err) => logger.error("alerts.offline_check_failed", {}, err)
    );
  g.__rioAlertScheduler = setInterval(tick, intervalMs);
  g.__rioAlertScheduler.unref?.();
  logger.info("alerts.scheduler_started", { intervalSeconds: intervalMs / 1000 });
}
