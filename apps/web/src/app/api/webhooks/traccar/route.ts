import { isUsableFix, locationChannel } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { TraccarWebhookAuthError, TraccarWebhookPayloadError, parseWebhookPosition, verifyWebhookSecret } from "@rio-gps/traccar-client";
import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getReadyRedisPublisher } from "@/lib/redis";

/**
 * Ingest endpoint Traccar's `forward.url` posts to on every position update.
 * Auth is a static shared secret (see TRACCAR_WEBHOOK_SECRET) rather than a user
 * session — this endpoint is machine-to-machine, not user-facing.
 */
export async function POST(request: Request) {
  const webhookSecret = process.env.TRACCAR_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  try {
    verifyWebhookSecret(request.headers.get("authorization"), webhookSecret);
  } catch (err) {
    if (err instanceof TraccarWebhookAuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw err;
  }

  let position;
  try {
    const body = await request.json();
    position = parseWebhookPosition(body);
  } catch (err) {
    if (err instanceof TraccarWebhookPayloadError) {
      return NextResponse.json({ error: "Invalid payload", detail: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isUsableFix(position)) {
    // No GNSS fix (or the 0,0 placeholder): acknowledge so Traccar doesn't retry,
    // but never overwrite a device's last good location with it.
    return NextResponse.json({ status: "ignored", reason: "no valid fix" }, { status: 202 });
  }

  const db = getDb();
  const [device] = await db
    .select({ id: schema.gpsDevices.id, organizationId: schema.gpsDevices.organizationId })
    .from(schema.gpsDevices)
    .where(eq(schema.gpsDevices.externalDeviceId, position.externalDeviceId))
    .limit(1);

  if (!device) {
    // Unregistered device — accept the request (so Traccar doesn't retry forever)
    // but do not write a location. A future milestone will raise an alert here.
    return NextResponse.json({ status: "ignored", reason: "unknown device" }, { status: 202 });
  }

  // Devices upload stored backlog oldest-first, and Traccar may redeliver, so a
  // record only replaces the current location if it is strictly newer
  // (exact duplicates are a no-op).
  const updated = await db
    .insert(schema.currentLocations)
    .values({
      deviceId: device.id,
      organizationId: device.organizationId,
      latitude: position.latitude,
      longitude: position.longitude,
      speedKph: position.speedKph,
      headingDeg: position.headingDeg,
      altitudeM: position.altitudeM,
      recordedAt: position.recordedAt,
      rawPayload: position
    })
    .onConflictDoUpdate({
      target: schema.currentLocations.deviceId,
      set: {
        latitude: position.latitude,
        longitude: position.longitude,
        speedKph: position.speedKph,
        headingDeg: position.headingDeg,
        altitudeM: position.altitudeM,
        recordedAt: position.recordedAt,
        receivedAt: new Date(),
        rawPayload: position
      },
      setWhere: sql`${schema.currentLocations.recordedAt} < excluded.recorded_at`
    })
    .returning({ deviceId: schema.currentLocations.deviceId });

  if (updated.length === 0) {
    return NextResponse.json({ status: "ignored", reason: "not newer than current location" }, { status: 202 });
  }

  // PostgreSQL is the source of truth and the write above has committed. A Redis
  // outage must not make Traccar retry (the data is already stored) — log it
  // loudly instead; live clients resync from the REST API on reconnect.
  try {
    await (await getReadyRedisPublisher()).publish(
      locationChannel(device.organizationId),
      JSON.stringify({ deviceId: device.id, ...position })
    );
  } catch (err) {
    logger.error("ingest.redis_publish_failed", { deviceId: device.id, organizationId: device.organizationId }, err);
  }

  return NextResponse.json({ status: "ok" });
}
