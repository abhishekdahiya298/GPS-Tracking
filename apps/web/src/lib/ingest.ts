import { isUsableFix, type NormalizedPosition } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { and, eq, isNull, sql } from "drizzle-orm";

export type IngestOutcome =
  | { status: "unknown_device" }
  | { status: "device_inactive"; deviceId: string; organizationId: string }
  | { status: "no_fix"; deviceId: string; organizationId: string }
  | { status: "duplicate"; deviceId: string; organizationId: string }
  | { status: "stored"; deviceId: string; organizationId: string; historyId: number; currentUpdated: boolean };

/**
 * Persists one normalized position. PostgreSQL is the source of truth; callers
 * publish to Redis only after this resolves (i.e. after commit).
 *
 * 1. last_seen_at is bumped for any record from a known device, fix or not
 *    (the device is alive even with no GNSS lock).
 * 2. Inside one transaction:
 *    a. append to location_history; (device_id, recorded_at) makes redelivery a no-op
 *    b. upsert current_locations only if strictly newer (late backlog stays history-only)
 */
export interface IngestOptions {
  now?: Date;
  /** false for backfills: importing old points must not make a device look online. */
  touchLastSeen?: boolean;
}

export async function ingestPosition(position: NormalizedPosition, options: IngestOptions = {}): Promise<IngestOutcome> {
  const db = getDb();
  const now = options.now ?? new Date();
  const touchLastSeen = options.touchLastSeen ?? true;

  // The device lookup is by provider identity; the organization comes from RIO's
  // own registry, never from the payload.
  const [device] = await db
    .update(schema.gpsDevices)
    .set({
      lastSeenAt: touchLastSeen
        ? sql`greatest(${schema.gpsDevices.lastSeenAt}, ${now.toISOString()}::timestamptz)`
        : sql`${schema.gpsDevices.lastSeenAt}`
    })
    .where(eq(schema.gpsDevices.externalDeviceId, position.externalDeviceId))
    .returning({ id: schema.gpsDevices.id, organizationId: schema.gpsDevices.organizationId, status: schema.gpsDevices.status });

  if (!device) return { status: "unknown_device" };
  const ids = { deviceId: device.id, organizationId: device.organizationId };
  // Deactivated by the customer: keep last_seen (the hardware is alive) but store no location.
  if (device.status !== "active") return { status: "device_inactive", ...ids };
  if (!isUsableFix(position)) return { status: "no_fix", ...ids };

  return db.transaction(async (tx) => {
    const [assignment] = await tx
      .select({ vehicleId: schema.deviceAssignments.vehicleId })
      .from(schema.deviceAssignments)
      .where(
        and(
          eq(schema.deviceAssignments.deviceId, device.id),
          eq(schema.deviceAssignments.organizationId, device.organizationId),
          isNull(schema.deviceAssignments.unassignedAt)
        )
      )
      .limit(1);

    const fields = {
      latitude: position.latitude,
      longitude: position.longitude,
      speedKph: position.speedKph,
      headingDeg: position.headingDeg,
      altitudeM: position.altitudeM,
      ignition: position.ignition,
      motion: position.motion,
      recordedAt: position.recordedAt
    };

    const [history] = await tx
      .insert(schema.locationHistory)
      .values({
        organizationId: device.organizationId,
        deviceId: device.id,
        vehicleId: assignment?.vehicleId ?? null,
        receivedAt: now,
        ...fields
      })
      .onConflictDoNothing({ target: [schema.locationHistory.deviceId, schema.locationHistory.recordedAt] })
      .returning({ id: schema.locationHistory.id });

    if (!history) return { status: "duplicate", ...ids } as const;

    const current = await tx
      .insert(schema.currentLocations)
      .values({ deviceId: device.id, organizationId: device.organizationId, receivedAt: now, rawPayload: position, ...fields })
      .onConflictDoUpdate({
        target: schema.currentLocations.deviceId,
        set: { ...fields, receivedAt: now, rawPayload: position },
        setWhere: sql`${schema.currentLocations.recordedAt} < excluded.recorded_at`
      })
      .returning({ deviceId: schema.currentLocations.deviceId });

    return { status: "stored", ...ids, historyId: history.id, currentUpdated: current.length > 0 } as const;
  });
}
