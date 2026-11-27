import type { NormalizedPosition } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { and, asc, eq, gt, gte, isNull, lt, or, sql } from "drizzle-orm";

/**
 * Read models for tenant-scoped location APIs. Every function takes the
 * organizationId from a server-derived TenantContext and filters on it; none
 * accepts an organization from the client.
 */

export interface LocationPoint {
  latitude: number;
  longitude: number;
  speedKph: number | null;
  headingDeg: number | null;
  altitudeM: number | null;
  ignition: boolean | null;
  motion: boolean | null;
  recordedAt: string;
}

/** Payload of an SSE `location` event; same point shape as the REST APIs. */
export interface LiveLocationEvent extends LocationPoint {
  deviceId: string;
  receivedAt: string;
}

export function toLiveEvent(deviceId: string, p: NormalizedPosition, receivedAt = new Date()): LiveLocationEvent {
  return {
    deviceId,
    latitude: p.latitude,
    longitude: p.longitude,
    speedKph: p.speedKph,
    headingDeg: p.headingDeg,
    altitudeM: p.altitudeM,
    ignition: p.ignition,
    motion: p.motion,
    recordedAt: p.recordedAt.toISOString(),
    receivedAt: receivedAt.toISOString()
  };
}

/** External voltage stored with the latest record (NormalizedPosition.externalPowerV). */
function powerFromRaw(raw: unknown): number | null {
  const v = raw && typeof raw === "object" ? (raw as { externalPowerV?: unknown }).externalPowerV : null;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export type ConnectivityStatus = "online" | "offline" | "never_seen";

export function connectivityStatus(lastSeenAt: Date | null, now: Date, thresholdSeconds: number): ConnectivityStatus {
  if (!lastSeenAt) return "never_seen";
  return now.getTime() - lastSeenAt.getTime() <= thresholdSeconds * 1000 ? "online" : "offline";
}

export interface CurrentDeviceLocation {
  deviceId: string;
  model: string | null;
  name: string | null;
  deviceStatus: string;
  vehicle: { id: string; name: string; licensePlate: string | null; type: string } | null;
  connectivity: ConnectivityStatus;
  lastSeenAt: string | null;
  location: (LocationPoint & { receivedAt: string }) | null;
  /** Vehicle (external) voltage from the latest record, when the tracker reports it. */
  powerV?: number | null;
}

export async function listCurrentLocations(
  organizationId: string,
  now: Date,
  offlineThresholdSeconds: number
): Promise<CurrentDeviceLocation[]> {
  const db = getDb();
  const rows = await db
    .select({
      deviceId: schema.gpsDevices.id,
      model: schema.gpsDevices.model,
      name: schema.gpsDevices.name,
      deviceStatus: schema.gpsDevices.status,
      lastSeenAt: schema.gpsDevices.lastSeenAt,
      vehicleId: schema.vehicles.id,
      vehicleName: schema.vehicles.name,
      licensePlate: schema.vehicles.licensePlate,
      vehicleType: schema.vehicles.type,
      loc: schema.currentLocations
    })
    .from(schema.gpsDevices)
    .leftJoin(
      schema.currentLocations,
      and(
        eq(schema.currentLocations.deviceId, schema.gpsDevices.id),
        eq(schema.currentLocations.organizationId, organizationId)
      )
    )
    .leftJoin(
      schema.deviceAssignments,
      and(
        eq(schema.deviceAssignments.deviceId, schema.gpsDevices.id),
        eq(schema.deviceAssignments.organizationId, organizationId),
        isNull(schema.deviceAssignments.unassignedAt)
      )
    )
    .leftJoin(
      schema.vehicles,
      and(eq(schema.vehicles.id, schema.deviceAssignments.vehicleId), eq(schema.vehicles.organizationId, organizationId))
    )
    .where(and(eq(schema.gpsDevices.organizationId, organizationId), eq(schema.gpsDevices.status, "active")))
    .orderBy(asc(schema.gpsDevices.createdAt));

  return rows.map((r) => ({
    deviceId: r.deviceId,
    model: r.model,
    name: r.name,
    deviceStatus: r.deviceStatus,
    vehicle: r.vehicleId ? { id: r.vehicleId, name: r.vehicleName!, licensePlate: r.licensePlate, type: r.vehicleType ?? "truck" } : null,
    connectivity: connectivityStatus(r.lastSeenAt, now, offlineThresholdSeconds),
    lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
    powerV: powerFromRaw(r.loc?.rawPayload),
    location: r.loc
      ? {
          latitude: r.loc.latitude,
          longitude: r.loc.longitude,
          speedKph: r.loc.speedKph,
          headingDeg: r.loc.headingDeg,
          altitudeM: r.loc.altitudeM,
          ignition: r.loc.ignition,
          motion: r.loc.motion,
          recordedAt: r.loc.recordedAt.toISOString(),
          receivedAt: r.loc.receivedAt.toISOString()
        }
      : null
  }));
}

/** True only if the device exists AND belongs to the organization. */
export async function deviceBelongsToOrg(deviceId: string, organizationId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: schema.gpsDevices.id })
    .from(schema.gpsDevices)
    .where(and(eq(schema.gpsDevices.id, deviceId), eq(schema.gpsDevices.organizationId, organizationId)))
    .limit(1);
  return Boolean(row);
}

export interface HistoryCursor {
  t: string;
  id: number;
}

export function encodeCursor(c: HistoryCursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

export function decodeCursor(raw: string): HistoryCursor | null {
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (
      v &&
      typeof v === "object" &&
      typeof (v as HistoryCursor).t === "string" &&
      Number.isSafeInteger((v as HistoryCursor).id) &&
      !Number.isNaN(Date.parse((v as HistoryCursor).t))
    ) {
      return v as HistoryCursor;
    }
  } catch {
    // fall through
  }
  return null;
}

export async function queryHistory(args: {
  organizationId: string;
  deviceId: string;
  from: Date;
  to: Date;
  limit: number;
  cursor: HistoryCursor | null;
}): Promise<{ points: LocationPoint[]; nextCursor: string | null }> {
  const h = schema.locationHistory;
  const conditions = [
    eq(h.organizationId, args.organizationId),
    eq(h.deviceId, args.deviceId),
    gte(h.recordedAt, args.from),
    lt(h.recordedAt, args.to)
  ];
  if (args.cursor) {
    const t = new Date(args.cursor.t);
    conditions.push(or(gt(h.recordedAt, t), and(eq(h.recordedAt, t), gt(h.id, args.cursor.id)))!);
  }
  const rows = await getDb()
    .select()
    .from(h)
    .where(and(...conditions))
    .orderBy(asc(h.recordedAt), asc(h.id))
    .limit(args.limit + 1);

  const page = rows.slice(0, args.limit);
  const last = page.at(-1);
  return {
    points: page.map((r) => ({
      latitude: r.latitude,
      longitude: r.longitude,
      speedKph: r.speedKph,
      headingDeg: r.headingDeg,
      altitudeM: r.altitudeM,
      ignition: r.ignition,
      motion: r.motion,
      recordedAt: r.recordedAt.toISOString()
    })),
    nextCursor: rows.length > args.limit && last ? encodeCursor({ t: last.recordedAt.toISOString(), id: last.id }) : null
  };
}

/** Most points one history request returns in full; longer windows get the overview below. */
export const HISTORY_FULL_POINTS = 20_000;
/** Target size of the overview track for long windows. */
export const HISTORY_OVERVIEW_POINTS = 12_000;

export interface HistoryOverview {
  /** Real recorded points, in time order: a subset of the full track (nothing is invented or moved). */
  points: LocationPoint[];
  /** Points recorded in the window. */
  totalPoints: number;
  /** Distance and top speed worked out from every recorded point, not just the overview. */
  distanceKm: number;
  maxSpeedKph: number;
}

/**
 * For a window with more than `HISTORY_FULL_POINTS` points, returns an overview track instead of
 * the whole thing, so a week or a month draws in one go instead of stopping at a point limit:
 * one real point per time slice, plus every point where ignition or motion changes and both
 * sides of any reporting gap over 5 minutes, so trips, stops and idling keep their real times.
 * Distance and top speed come from all points. Returns null when the full track is small enough.
 */
export async function historyOverview(args: { organizationId: string; deviceId: string; from: Date; to: Date; target?: number }): Promise<HistoryOverview | null> {
  const db = getDb();
  const target = args.target ?? HISTORY_OVERVIEW_POINTS;
  const where = sql`organization_id = ${args.organizationId} and device_id = ${args.deviceId} and recorded_at >= ${args.from.toISOString()}::timestamptz and recorded_at < ${args.to.toISOString()}::timestamptz`;
  const [agg] = await db.execute<{ n: string; km: string | null; vmax: string | null }>(sql`
    select count(*)::text as n,
           sum(case when dt_h > 0 and d_km / dt_h <= 250 then d_km end)::text as km,
           max(speed_kph)::text as vmax
    from (
      select speed_kph,
             2 * 6371 * asin(sqrt(power(sin(radians(latitude - lag(latitude) over w) / 2), 2)
               + cos(radians(lag(latitude) over w)) * cos(radians(latitude)) * power(sin(radians(longitude - lag(longitude) over w) / 2), 2))) as d_km,
             extract(epoch from recorded_at - lag(recorded_at) over w) / 3600 as dt_h
      from location_history where ${where}
      window w as (order by recorded_at, id)
    ) x`);
  const total = Number(agg?.n ?? 0);
  if (total <= HISTORY_FULL_POINTS) return null;
  const sliceMs = Math.max(1000, Math.ceil((args.to.getTime() - args.from.getTime()) / target));
  const rows = await db.execute<{
    latitude: number; longitude: number; speed_kph: number | null; heading_deg: number | null; altitude_m: number | null;
    ignition: boolean | null; motion: boolean | null; recorded_at: Date | string;
  }>(sql`
    select latitude, longitude, speed_kph, heading_deg, altitude_m, ignition, motion, recorded_at from (
      select *,
             row_number() over (partition by floor(extract(epoch from recorded_at) * 1000 / ${sliceMs}) order by recorded_at, id) as rn,
             lag(ignition) over w as prev_ign, lag(motion) over w as prev_motion,
             lag(recorded_at) over w as prev_t, lead(recorded_at) over w as next_t,
             lead(recorded_at) over w is null as is_last
      from location_history where ${where}
      window w as (order by recorded_at, id)
    ) p
    where rn = 1 or is_last
       or prev_ign is distinct from ignition or prev_motion is distinct from motion
       or recorded_at - prev_t > interval '5 minutes' or next_t - recorded_at > interval '5 minutes'
    order by recorded_at, id
    limit ${target * 3}`);
  return {
    points: rows.map((r) => ({
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      speedKph: r.speed_kph === null ? null : Number(r.speed_kph),
      headingDeg: r.heading_deg === null ? null : Number(r.heading_deg),
      altitudeM: r.altitude_m === null ? null : Number(r.altitude_m),
      ignition: r.ignition,
      motion: r.motion,
      recordedAt: new Date(r.recorded_at).toISOString()
    })),
    totalPoints: total,
    distanceKm: Number(agg?.km ?? 0),
    maxSpeedKph: Number(agg?.vmax ?? 0)
  };
}
