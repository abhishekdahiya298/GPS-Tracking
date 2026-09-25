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

/** 15-digit IMEI with a valid Luhn check digit (catches most typos). */
export function isValidImei(imei: string): boolean {
  if (!/^\d{15}$/.test(imei)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = Number(imei[14 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}
