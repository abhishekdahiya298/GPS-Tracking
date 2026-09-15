import { locationChannel } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { TraccarWebhookAuthError, TraccarWebhookPayloadError, parseWebhookPosition, verifyWebhookSecret } from "@rio-gps/traccar-client";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getRedisPublisher } from "@/lib/redis";

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

  await db
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
      }
    });

  await getRedisPublisher().publish(
    locationChannel(device.organizationId),
    JSON.stringify({ deviceId: device.id, ...position })
  );

  return NextResponse.json({ status: "ok" });
}
