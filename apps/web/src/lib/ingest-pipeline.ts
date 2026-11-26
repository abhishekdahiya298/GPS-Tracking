import { deviceSeenChannel, locationChannel, type NormalizedPosition } from "@rio-gps/core";
import { evaluateAlertsForPosition } from "./alerts";
import { countIngest } from "./ingest-stats";
import { updateLoadsForDevicePosition } from "./load-tracking";
import { toLiveEvent } from "./locations";
import { logger } from "./logger";
import { isOrganizationActive } from "./organization-status";
import { getReadyRedisPublisher } from "./redis";
import { shouldPublishSeen } from "./seen-throttle";

/**
 * What happens after a position is stored and is the newest for its device, for every source
 * (Traccar trackers and drivers' phones): live map event, alerts, loads followed by the vehicle.
 * Never throws: the position is already committed.
 */
export async function afterStoredPosition(device: { id: string; organizationId: string }, position: NormalizedPosition, accuracyM: number | null = null): Promise<void> {
  // A Redis outage must not fail the ingest (the data is stored); live clients resync on reconnect.
  try {
    await (await getReadyRedisPublisher()).publish(locationChannel(device.organizationId), JSON.stringify(toLiveEvent(device.id, position)));
  } catch (err) {
    countIngest("publish_failed");
    logger.error("ingest.redis_publish_failed", { deviceId: device.id, organizationId: device.organizationId }, err);
  }
  try {
    // A suspended customer keeps its history but gets no alerts or load updates.
    if (!(await isOrganizationActive(device.organizationId))) return;
    await evaluateAlertsForPosition(device, { latitude: position.latitude, longitude: position.longitude, speedKph: position.speedKph, ignition: position.ignition, recordedAt: position.recordedAt });
    await updateLoadsForDevicePosition(device, { latitude: position.latitude, longitude: position.longitude, accuracyM, speedKph: position.speedKph, at: position.recordedAt });
  } catch (err) {
    logger.error("ingest.after_store_failed", { deviceId: device.id }, err);
  }
}

/** Payload of the live `seen` event: the tracker reported, but there is no new current position. */
export interface DeviceSeenEvent {
  deviceId: string;
  lastSeenAt: string;
}

/**
 * The tracker reported (last_seen was updated) but nothing new goes on the map: no GNSS fix, or a
 * late backlog record. Tell open live maps so "last seen" and online/offline stay current, instead
 * of freezing until their next snapshot. Throttled per device; never throws.
 */
export async function publishDeviceSeen(device: { id: string; organizationId: string }, seenAt = new Date()): Promise<void> {
  if (!shouldPublishSeen(device.id, seenAt.getTime())) return;
  const event: DeviceSeenEvent = { deviceId: device.id, lastSeenAt: seenAt.toISOString() };
  try {
    await (await getReadyRedisPublisher()).publish(deviceSeenChannel(device.organizationId), JSON.stringify(event));
  } catch (err) {
    countIngest("publish_failed");
    logger.error("ingest.redis_seen_publish_failed", { deviceId: device.id, organizationId: device.organizationId }, err);
  }
}
