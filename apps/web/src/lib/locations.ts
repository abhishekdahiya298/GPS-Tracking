import type { NormalizedPosition } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { and, asc, eq, gt, gte, isNull, lt, or } from "drizzle-orm";

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

export type ConnectivityStatus = "online" | "offline" | "never_seen";

export function connectivityStatus(lastSeenAt: Date | null, now: Date, thresholdSeconds: number): ConnectivityStatus {
  if (!lastSeenAt) return "never_seen";
  return now.getTime() - lastSeenAt.getTime() <= thresholdSeconds * 1000 ? "online" : "offline";
}

export interface CurrentDeviceLocation {
  deviceId: string;
  model: string | null;
  deviceStatus: string;
  vehicle: { id: string; name: string; licensePlate: string | null } | null;
  connectivity: ConnectivityStatus;
  lastSeenAt: string | null;
  location: (LocationPoint & { receivedAt: string }) | null;
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
      deviceStatus: schema.gpsDevices.status,
      lastSeenAt: schema.gpsDevices.lastSeenAt,
      vehicleId: schema.vehicles.id,
      vehicleName: schema.vehicles.name,
      licensePlate: schema.vehicles.licensePlate,
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
    .where(eq(schema.gpsDevices.organizationId, organizationId))
    .orderBy(asc(schema.gpsDevices.createdAt));

  return rows.map((r) => ({
    deviceId: r.deviceId,
    model: r.model,
    deviceStatus: r.deviceStatus,
    vehicle: r.vehicleId ? { id: r.vehicleId, name: r.vehicleName!, licensePlate: r.licensePlate } : null,
    connectivity: connectivityStatus(r.lastSeenAt, now, offlineThresholdSeconds),
    lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
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
