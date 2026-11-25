import { locationChannel, type NormalizedPosition } from "@rio-gps/core";
import { evaluateAlertsForPosition } from "./alerts";
import { countIngest } from "./ingest-stats";
import { updateLoadsForDevicePosition } from "./load-tracking";
import { toLiveEvent } from "./locations";
import { logger } from "./logger";
import { isOrganizationActive } from "./organization-status";
import { getReadyRedisPublisher } from "./redis";

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
