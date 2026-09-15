import { z } from "zod";

/** RIO-side identity for a GPS device, independent of any provider's internal id scheme. */
export interface GpsDeviceIdentity {
  id: string;
  organizationId: string;
  providerId: string;
  /** Provider's own id for this device (e.g. Traccar's `uniqueId`), stable across provider restarts. */
  externalDeviceId: string;
  /** Hardware IMEI — the true stable identity, independent of any provider. */
  imei: string;
}

export const OrganizationScopedSchema = z.object({
  organizationId: z.string().uuid()
});
