import { TraccarWebhookAuthError, TraccarWebhookPayloadError, parseWebhookPosition, verifyWebhookSecret } from "@rio-gps/traccar-client";
import { NextResponse } from "next/server";
import { ingestPosition } from "@/lib/ingest";
import { afterStoredPosition } from "@/lib/ingest-pipeline";
import { countIngest } from "@/lib/ingest-stats";
import { logger } from "@/lib/logger";

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
    case "in_stock":
      // A tracker in RIO's stock (e.g. being tested before shipping): alive, nothing stored.
      return NextResponse.json({ status: "ignored", reason: "tracker in stock" }, { status: 202 });
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
  await afterStoredPosition({ id: outcome.deviceId, organizationId: outcome.organizationId }, position);
  return NextResponse.json({ status: "ok" });
}
