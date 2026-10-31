import { estimateLoadEta, isLoadEnded, isLoadTracking, LOAD_STALE_MINUTES, nextLoadStatus, type LoadEventType, type LoadStatus } from "@rio-gps/core/loads";
import type { LoadAlertType } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { deliver, type FiredEvent } from "./alerts";
import { logger } from "./logger";

/**
 * What happens when a load gets new positions, from either source:
 * - the driver's phone (driver link / app), via recordDriverPositions in load-public.ts
 * - one of the organization's own trackers (vehicle mode), via the GPS ingest webhook
 *
 * Positions move the status forward (nextLoadStatus), update the "last position", clear a
 * "no signal" alert, and raise alerts for arrivals and automatic delivery. A periodic check
 * (runLoadChecks) raises "running late" and "no signal" once each.
 */
type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type LoadRow = typeof schema.loads.$inferSelect;

export interface LoadPoint {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  speedKph: number | null;
  at: Date;
}

export interface AppliedPositions {
  status: LoadStatus;
  events: { type: LoadEventType; at: Date; latitude: number; longitude: number }[];
}

/**
 * Applies positions (oldest first, already stored or not needed to be stored) to a load row that
 * the caller has locked FOR UPDATE inside `tx`. Only positions newer than the load's last
 * position count. Writes the load row and its timeline events; returns what changed.
 */
export async function applyLoadPositions(tx: Tx, l: LoadRow, points: LoadPoint[], now = new Date()): Promise<AppliedPositions> {
  const lastAt = l.lastPositionAt?.getTime() ?? 0;
  let status = l.status;
  const events: AppliedPositions["events"] = [];
  const pickup = { latitude: l.pickupLat, longitude: l.pickupLon, radiusM: l.pickupRadiusM };
  const delivery = { latitude: l.deliveryLat, longitude: l.deliveryLon, radiusM: l.deliveryRadiusM };
  let newest: LoadPoint | null = null;
  for (const p of points) {
    if (p.at.getTime() <= lastAt) continue;
    newest = p;
    const step = nextLoadStatus(status, { latitude: p.latitude, longitude: p.longitude, accuracyM: p.accuracyM }, pickup, delivery);
    for (const type of step.events) events.push({ type, at: p.at, latitude: p.latitude, longitude: p.longitude });
    status = step.status;
    if (isLoadEnded(status)) break;
  }
  if (newest) {
    await tx
      .update(schema.loads)
      .set({
        status,
        lastLat: newest.latitude,
        lastLon: newest.longitude,
        lastAccuracyM: newest.accuracyM,
        lastSpeedKph: newest.speedKph,
        lastPositionAt: newest.at,
        staleAlertedAt: null,
        ...(isLoadEnded(status) ? { endedAt: now } : {}),
        updatedAt: now
      })
      .where(eq(schema.loads.id, l.id));
  }
  if (events.length) {
    await tx.insert(schema.loadEvents).values(events.map((e) => ({ organizationId: l.organizationId, loadId: l.id, type: e.type, at: e.at, latitude: e.latitude, longitude: e.longitude, detail: { automatic: true } })));
    logger.info("load.status_changed", { loadId: l.id, from: l.status, to: status });
  }
  return { status, events };
}

// ---------- alerts ----------

/** Problems are emailed to the team; arrivals and deliveries are in-app and push only. */
const EMAILED: readonly LoadAlertType[] = ["load_late", "load_no_signal", "load_paused"];

const ALERT_FOR_EVENT: Partial<Record<LoadEventType, LoadAlertType>> = {
  arrived_pickup: "load_arrived",
  arrived_delivery: "load_arrived",
  delivered: "load_delivered",
  sharing_stopped: "load_paused"
};

export interface LoadAlert {
  type: LoadAlertType;
  at: Date;
  latitude?: number | null;
  longitude?: number | null;
  details?: Record<string, unknown>;
}

/** Inserts alert events for a load and delivers them (live list, push, email for problems). Never throws. */
export async function raiseLoadAlerts(l: Pick<LoadRow, "id" | "organizationId" | "reference" | "vehicleId">, alerts: LoadAlert[]): Promise<void> {
  if (!alerts.length) return;
  try {
    const rows = await getDb()
      .insert(schema.alertEvents)
      .values(
        alerts.map((a) => ({
          organizationId: l.organizationId,
          ruleId: null,
          ruleName: `Load ${l.reference}`,
          type: a.type,
          deviceId: null,
          vehicleId: l.vehicleId,
          occurredAt: a.at,
          latitude: a.latitude ?? null,
          longitude: a.longitude ?? null,
          details: { loadId: l.id, reference: l.reference, ...(a.details ?? {}) }
        }))
      )
      .returning();
    const fired: FiredEvent[] = rows.map((row) => ({ row, rule: { id: "", name: `Load ${l.reference}`, notifyEmail: EMAILED.includes(row.type as LoadAlertType) } }));
    await deliver(l.organizationId, fired);
  } catch (err) {
    logger.error("load.alerts_failed", { loadId: l.id }, err);
  }
}

/** Alerts for the timeline events a batch of positions (or a driver action) produced. */
export function alertsForEvents(events: { type: LoadEventType; at: Date; latitude?: number; longitude?: number }[]): LoadAlert[] {
  return events.flatMap((e) => {
    const type = ALERT_FOR_EVENT[e.type];
    if (!type) return [];
    const stop = e.type === "arrived_pickup" ? "pickup" : e.type === "arrived_delivery" ? "delivery" : undefined;
    return [{ type, at: e.at, latitude: e.latitude ?? null, longitude: e.longitude ?? null, details: stop ? { stop } : {} }];
  });
}

// ---------- vehicle mode ----------

/**
 * A new committed position from one of the organization's trackers: moves every active load
 * that follows the tracker's vehicle. Called after ingest; never fails the ingest.
 */
export async function updateLoadsForDevicePosition(device: { id: string; organizationId: string }, point: LoadPoint, now = new Date()): Promise<number> {
  try {
    const db = getDb();
    const a = schema.deviceAssignments;
    const l = schema.loads;
    const candidates = await db
      .select({ id: l.id })
      .from(l)
      .innerJoin(a, and(eq(a.vehicleId, l.vehicleId), eq(a.deviceId, device.id), eq(a.organizationId, device.organizationId), isNull(a.unassignedAt)))
      .where(and(eq(l.organizationId, device.organizationId), eq(l.trackingMode, "vehicle"), inArray(l.status, ["tracking", "at_pickup", "in_transit", "at_delivery"])));
    for (const c of candidates) {
      const result = await db.transaction(async (tx) => {
        const [row] = await tx.select().from(l).where(eq(l.id, c.id)).for("update");
        if (!row || !isLoadTracking(row.status)) return null;
        return { row, applied: await applyLoadPositions(tx, row, [point], now) };
      });
      if (result) await raiseLoadAlerts(result.row, alertsForEvents(result.applied.events));
    }
    return candidates.length;
  } catch (err) {
    logger.error("load.vehicle_update_failed", { deviceId: device.id }, err);
    return 0;
  }
}

// ---------- periodic check ----------

const LOAD_CHECK_LOCK_KEY = 72_610_026;

/**
 * Once a minute (single runner): for every load being tracked and not paused,
 * - "no signal": no position for LOAD_STALE_MINUTES (counted from acceptance when there is none yet), raised once until a position arrives;
 * - "running late": the estimate is past the next stop's appointment (plus grace), raised once per stop.
 */
export async function runLoadChecks(now = new Date()): Promise<number> {
  const db = getDb();
  const pending = await db.transaction(async (tx) => {
    const [lock] = await tx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(${LOAD_CHECK_LOCK_KEY}) as ok`);
    if (!(lock as { ok?: boolean } | undefined)?.ok) return [];
    const l = schema.loads;
    const rows = await tx
      .select()
      .from(l)
      .where(
        and(
          inArray(l.status, ["tracking", "at_pickup", "in_transit", "at_delivery"]),
          isNull(l.sharingStoppedAt),
          // Only active customers: a suspended or archived one gets no load alerts.
          sql`exists (select 1 from organizations o where o.id = ${l.organizationId} and o.status = 'active')`
        )
      )
      .limit(5_000);
    const out: { row: LoadRow; alert: LoadAlert }[] = [];
    for (const r of rows) {
      const since = r.lastPositionAt ?? r.acceptedAt ?? r.createdAt;
      if (!r.staleAlertedAt && now.getTime() - since.getTime() > LOAD_STALE_MINUTES * 60_000) {
        await tx.update(l).set({ staleAlertedAt: now }).where(eq(l.id, r.id));
        out.push({ row: r, alert: { type: "load_no_signal", at: now, latitude: r.lastLat, longitude: r.lastLon, details: { minutes: Math.round((now.getTime() - since.getTime()) / 60_000) } } });
      }
      if (r.lastLat !== null && r.lastLon !== null && r.lastPositionAt) {
        const eta = estimateLoadEta(
          r.status,
          { latitude: r.lastLat, longitude: r.lastLon },
          r.lastPositionAt,
          { latitude: r.pickupLat, longitude: r.pickupLon, radiusM: r.pickupRadiusM, appointmentAt: r.pickupAppointmentAt },
          { latitude: r.deliveryLat, longitude: r.deliveryLon, radiusM: r.deliveryRadiusM, appointmentAt: r.deliveryAppointmentAt }
        );
        if (eta?.late && r.lateAlertTarget !== eta.target) {
          await tx.update(l).set({ lateAlertTarget: eta.target }).where(eq(l.id, r.id));
          out.push({ row: r, alert: { type: "load_late", at: now, latitude: r.lastLat, longitude: r.lastLon, details: { target: eta.target, lateByMinutes: eta.lateByMinutes, etaAt: eta.eta.toISOString() } } });
        }
      }
    }
    return out;
  });
  for (const p of pending) await raiseLoadAlerts(p.row, [p.alert]);
  return pending.length;
}

const g = globalThis as unknown as { __rioLoadScheduler?: NodeJS.Timeout };

export function startLoadScheduler(intervalMs = 60_000) {
  if (g.__rioLoadScheduler) return;
  const tick = () =>
    runLoadChecks().then(
      (n) => n > 0 && logger.info("load.checks", { fired: n }),
      (err) => logger.error("load.checks_failed", {}, err)
    );
  g.__rioLoadScheduler = setInterval(tick, intervalMs);
  g.__rioLoadScheduler.unref?.();
  logger.info("load.scheduler_started", { intervalSeconds: intervalMs / 1000 });
}
