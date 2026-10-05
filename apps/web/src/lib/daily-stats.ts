import { mileageByDay } from "@rio-gps/core";
import { addDays, canonicalTimeZone, dateFormatter, startOfLocalDay } from "@rio-gps/core/timezones";
import { getDb, schema } from "@rio-gps/db";
import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import { logger } from "./logger";
import { loadTrack } from "./reports";

/**
 * Daily per-device summaries (`device_daily_stats`): distance, driving and idle time, trips
 * and top speed per local calendar day. Derived from `location_history` with the same trip
 * engine as the reports, so the numbers agree; it can always be rebuilt and never changes
 * GPS data. Dashboards read this table instead of re-reading raw points on every visit.
 *
 * Keeping it fresh without touching the ingest path:
 * - `location_history.id` grows in insertion order, so "what arrived since the last pass"
 *   is `id > watermark`, including points a tracker delivered late for an earlier day.
 * - Each (device, local day) that received points is recomputed from scratch (idempotent).
 * - The watermark only advances over rows older than two minutes, so a transaction that
 *   was still open during a pass is picked up by the next one.
 * - Days are in the organization's time zone; when that changes, the organization's rows
 *   are rebuilt.
 */

/** How far back the first run (and a time-zone change) rebuilds. */
export const STATS_BACKFILL_DAYS = 35;
/** Extra track loaded around the day so trips are detected exactly as in a longer range. */
const PAD_BEFORE_MS = 2 * 3_600_000;
const PAD_AFTER_MS = 3_600_000;

type Pair = { organizationId: string; deviceId: string; day: string };

async function computeDay(p: Pair, timeZone: string): Promise<void> {
  const from = new Date(startOfLocalDay(p.day, timeZone).getTime() - PAD_BEFORE_MS);
  const to = new Date(startOfLocalDay(addDays(p.day, 1), timeZone).getTime() + PAD_AFTER_MS);
  const track = await loadTrack(p.organizationId, p.deviceId, from, to);
  const d = mileageByDay(track, timeZone).find((x) => x.day === p.day);
  const t = schema.deviceDailyStats;
  const db = getDb();
  if (!d) {
    // Points but no trip that day (parked with the tracker reporting): no row.
    await db.delete(t).where(and(eq(t.deviceId, p.deviceId), eq(t.day, p.day)));
    return;
  }
  const values = { timeZone, distanceM: d.distanceM, drivingS: d.drivingS, idleS: d.idleS, trips: d.trips, maxSpeedKph: d.maxSpeedKph, computedAt: new Date() };
  await db
    .insert(t)
    .values({ organizationId: p.organizationId, deviceId: p.deviceId, day: p.day, ...values })
    .onConflictDoUpdate({ target: [t.deviceId, t.day], set: values });
}

export interface StatsPassResult {
  recomputed: number;
  failed: number;
  rebuiltOrganizations: number;
  watermark: number;
}

let running: Promise<StatsPassResult> | null = null;

/** One pass. Concurrent callers share the pass in flight (upserts are idempotent anyway). */
export function refreshDailyStats(now = new Date()): Promise<StatsPassResult> {
  running ??= pass(now).finally(() => {
    running = null;
  });
  return running;
}

async function pass(now: Date): Promise<StatsPassResult> {
  const db = getDb();
  const t = schema.deviceDailyStats;
  const [state] = await db.select().from(schema.dailyStatsState).where(eq(schema.dailyStatsState.id, 1));
  const firstRun = !state;
  const last = state?.lastHistoryId ?? 0;

  const orgs = await db.select({ id: schema.organizations.id, timeZone: schema.organizations.timeZone }).from(schema.organizations);
  const zone = new Map(orgs.map((o) => [o.id, canonicalTimeZone(o.timeZone) ?? "UTC"]));

  // New watermark first (see the header comment): rows committed after this are seen again next pass.
  const [wm] = await db.execute<{ id: string | null }>(sql`select max(id) as id from location_history where id > ${last} and received_at < ${new Date(now.getTime() - 120_000).toISOString()}::timestamptz`);
  const watermark = wm?.id ? Number(wm.id) : last;

  const dirty = new Map<string, Pair>();
  const add = (p: Pair) => dirty.set(`${p.deviceId}|${p.day}`, p);
  let rebuilt = 0;

  for (const o of orgs) {
    const tz = zone.get(o.id)!;
    const [stale] = await db.select({ day: t.day }).from(t).where(and(eq(t.organizationId, o.id), ne(t.timeZone, tz))).limit(1);
    if (!firstRun && !stale) continue;
    // First run, or the organization changed its time zone: rebuild the recent window.
    if (stale) await db.delete(t).where(eq(t.organizationId, o.id));
    rebuilt++;
    const since = new Date(now.getTime() - STATS_BACKFILL_DAYS * 86_400_000);
    const rows = await db.execute<{ device_id: string; day: string }>(
      sql`select device_id, (recorded_at at time zone ${tz})::date::text as day from location_history where organization_id = ${o.id} and recorded_at >= ${since.toISOString()}::timestamptz group by 1, 2`
    );
    for (const r of rows) add({ organizationId: o.id, deviceId: r.device_id, day: r.day });
  }

  if (!firstRun) {
    const rows = await db.execute<{ organization_id: string; device_id: string; day: string }>(
      sql`select h.organization_id, h.device_id, (h.recorded_at at time zone o.time_zone)::date::text as day
          from location_history h join organizations o on o.id = h.organization_id
          where h.id > ${last} group by 1, 2, 3`
    );
    for (const r of rows) add({ organizationId: r.organization_id, deviceId: r.device_id, day: r.day });
  }

  let recomputed = 0;
  let failed = 0;
  for (const p of dirty.values()) {
    try {
      await computeDay(p, zone.get(p.organizationId) ?? "UTC");
      recomputed++;
    } catch (err) {
      failed++;
      logger.error("stats.day_failed", { organizationId: p.organizationId, deviceId: p.deviceId, day: p.day }, err);
    }
  }

  await db
    .insert(schema.dailyStatsState)
    .values({ id: 1, lastHistoryId: watermark, updatedAt: now })
    .onConflictDoUpdate({ target: schema.dailyStatsState.id, set: { lastHistoryId: watermark, updatedAt: now } });
  if (recomputed || failed || rebuilt) logger.info("stats.pass", { recomputed, failed, rebuiltOrganizations: rebuilt, watermark });
  return { recomputed, failed, rebuiltOrganizations: rebuilt, watermark };
}

const g = globalThis as { __rioStatsScheduler?: NodeJS.Timeout };
export function startDailyStatsScheduler(intervalMs = 10 * 60_000) {
  if (g.__rioStatsScheduler) return;
  const tick = () => refreshDailyStats().catch((err) => logger.error("stats.scheduler_tick_failed", {}, err));
  g.__rioStatsScheduler = setInterval(tick, intervalMs);
  g.__rioStatsScheduler.unref?.();
  setTimeout(tick, 20_000).unref?.(); // first pass shortly after start (backfill on first deploy)
  logger.info("stats.scheduler_started", { intervalSeconds: intervalMs / 1000 });
}

// ---------- dashboard ----------

export interface FleetCharts {
  timeZone: string;
  /** Last 30 local days, oldest first, zero-filled. */
  mileage: { day: string; distanceKm: number }[];
  /** Last 7 local days. */
  idling: { idleMin: number; drivingMin: number; ratio: number | null };
  /** Speeding alerts in the last 7 local days, by vehicle. */
  speeding: { vehicle: string; events: number; maxSpeedKph: number | null }[];
  /** When the newest summary row was computed (null: nothing yet). */
  updatedAt: string | null;
}

/** Tenant-scoped: every query carries organizationId. `timeZone` is the organization's. */
export async function getFleetCharts(organizationId: string, timeZone: string, now = new Date()): Promise<FleetCharts> {
  const db = getDb();
  const t = schema.deviceDailyStats;
  const today = dateFormatter(timeZone).dayKey(now);
  const first = addDays(today, -29);
  const weekStart = addDays(today, -6);
  const scope = and(eq(t.organizationId, organizationId), eq(t.timeZone, timeZone), gte(t.day, first), lte(t.day, today));

  const [byDay, [upd], speeding] = await Promise.all([
    db
      .select({ day: t.day, distanceM: sql<string>`sum(${t.distanceM})`, drivingS: sql<string>`sum(${t.drivingS})`, idleS: sql<string>`sum(${t.idleS})` })
      .from(t)
      .where(scope)
      .groupBy(t.day),
    db.select({ at: sql<Date | null>`max(${t.computedAt})` }).from(t).where(scope),
    db.execute<{ vehicle: string; events: string; max_kph: number | null }>(
      sql`select coalesce(v.name, d.name, d.model, 'Device') as vehicle, count(*) as events, max((e.details->>'speedKph')::float) as max_kph
          from alert_events e
          left join vehicles v on v.id = e.vehicle_id and v.organization_id = ${organizationId}
          left join gps_devices d on d.id = e.device_id and d.organization_id = ${organizationId}
          where e.organization_id = ${organizationId} and e.type = 'speeding'
            and e.occurred_at >= ${startOfLocalDay(weekStart, timeZone).toISOString()}::timestamptz
          group by coalesce(e.vehicle_id, e.device_id), 1
          order by count(*) desc, 1
          limit 5`
    )
  ]);

  const map = new Map(byDay.map((r) => [r.day, r]));
  const mileage = Array.from({ length: 30 }, (_, i) => {
    const day = addDays(first, i);
    return { day, distanceKm: Math.round(Number(map.get(day)?.distanceM ?? 0) / 100) / 10 };
  });
  let idleS = 0;
  let drivingS = 0;
  for (const r of byDay) {
    if (r.day >= weekStart) {
      idleS += Number(r.idleS);
      drivingS += Number(r.drivingS);
    }
  }
  return {
    timeZone,
    mileage,
    idling: { idleMin: Math.round(idleS / 60), drivingMin: Math.round(drivingS / 60), ratio: idleS + drivingS > 0 ? idleS / (idleS + drivingS) : null },
    speeding: speeding.map((r) => ({ vehicle: r.vehicle, events: Number(r.events), maxSpeedKph: r.max_kph === null ? null : Math.round(Number(r.max_kph)) })),
    updatedAt: upd?.at ? new Date(upd.at).toISOString() : null
  };
}
