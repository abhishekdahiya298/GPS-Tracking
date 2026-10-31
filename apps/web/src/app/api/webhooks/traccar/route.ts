import { isOrganizationActive } from "@/lib/organization-status";
import { locationChannel } from "@rio-gps/core";
import { TraccarWebhookAuthError, TraccarWebhookPayloadError, parseWebhookPosition, verifyWebhookSecret } from "@rio-gps/traccar-client";
import { NextResponse } from "next/server";
import { evaluateAlertsForPosition } from "@/lib/alerts";
import { updateLoadsForDevicePosition } from "@/lib/load-tracking";
import { ingestPosition } from "@/lib/ingest";
import { countIngest } from "@/lib/ingest-stats";
import { toLiveEvent } from "@/lib/locations";
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
      countIngest("rejected_auth");
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
      countIngest("rejected_payload");
      return NextResponse.json({ error: "Invalid payload", detail: err.message }, { status: 400 });
    }
    countIngest("rejected_payload");
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let outcome;
  try {
    outcome = await ingestPosition(position);
  } catch (err) {
    // Nothing was committed; a 5xx lets Traccar retry the delivery.
    countIngest("store_failed");
    logger.error("ingest.store_failed", { externalDeviceId: position.externalDeviceId }, err);
    return NextResponse.json({ error: "Temporarily unavailable" }, { status: 503 });
  }
  if (outcome.status === "stored") countIngest(outcome.currentUpdated ? "stored" : "stored_late");
  else countIngest(outcome.status);
  switch (outcome.status) {
    case "unknown_device":
      // Accept (so Traccar doesn't retry forever) but store nothing.
      logger.warn("ingest.unknown_device", { externalDeviceId: position.externalDeviceId });
      return NextResponse.json({ status: "ignored", reason: "unknown device" }, { status: 202 });
    case "device_inactive":
      return NextResponse.json({ status: "ignored", reason: "device inactive" }, { status: 202 });
    case "customer_archived":
      return NextResponse.json({ status: "ignored", reason: "customer archived" }, { status: 202 });
    case "no_fix":
      // No GNSS fix (or the 0,0 placeholder): device is alive (last_seen updated) but no location is stored.
      return NextResponse.json({ status: "ignored", reason: "no valid fix" }, { status: 202 });
    case "duplicate":
      return NextResponse.json({ status: "ignored", reason: "duplicate" }, { status: 202 });
  }
  if (!outcome.currentUpdated) {
    // Late backlog record: stored in history, but older than the current location.
    return NextResponse.json({ status: "stored", current: false }, { status: 202 });
  }
  const device = { id: outcome.deviceId, organizationId: outcome.organizationId };

  // PostgreSQL is the source of truth and the write above has committed. A Redis
  // outage must not make Traccar retry (the data is already stored) — log it
  // loudly instead; live clients resync from the REST API on reconnect.
  try {
    await (await getReadyRedisPublisher()).publish(
      locationChannel(device.organizationId),
      JSON.stringify(toLiveEvent(device.id, position))
    );
  } catch (err) {
    countIngest("publish_failed");
    logger.error("ingest.redis_publish_failed", { deviceId: device.id, organizationId: device.organizationId }, err);
  }

  // A suspended customer keeps its history (above) but gets no alerts or load updates.
  if (!(await isOrganizationActive(device.organizationId))) return NextResponse.json({ status: "ok" });

  // Alerts run after the position is committed and never fail the ingest.
  await evaluateAlertsForPosition(device, {
    latitude: position.latitude,
    longitude: position.longitude,
    speedKph: position.speedKph,
    ignition: position.ignition,
    recordedAt: position.recordedAt
  });

  // Loads followed by this tracker's vehicle (vehicle mode). Never fails the ingest.
  await updateLoadsForDevicePosition(device, { latitude: position.latitude, longitude: position.longitude, accuracyM: null, speedKph: position.speedKph, at: position.recordedAt });

  return NextResponse.json({ status: "ok" });
}
