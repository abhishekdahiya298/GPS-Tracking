import { z } from "zod";

/**
 * Shape of a single position report as forwarded by Traccar's webhook.
 * Field names follow Traccar's `forward.url` template variables, not RIO's
 * internal naming — normalization happens in `normalizePosition`.
 */
export const TraccarWebhookPositionSchema = z.object({
  deviceId: z.coerce.number().int(),
  imei: z.string().min(5).optional(),
  uniqueId: z.string().min(1),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  speed: z.coerce.number().min(0).optional(),
  course: z.coerce.number().min(0).max(360).optional(),
  altitude: z.coerce.number().optional(),
  fixTime: z.coerce.date(),
  attributes: z.record(z.unknown()).optional()
});

export type TraccarWebhookPosition = z.infer<typeof TraccarWebhookPositionSchema>;

/** RIO's internal, provider-agnostic representation of a device position. */
export interface NormalizedPosition {
  externalDeviceId: string;
  imei: string | null;
  latitude: number;
  longitude: number;
  speedKph: number | null;
  headingDeg: number | null;
  altitudeM: number | null;
  recordedAt: Date;
}

/** Converts a raw Traccar webhook payload into RIO's normalized position shape. */
export function normalizePosition(raw: TraccarWebhookPosition): NormalizedPosition {
  return {
    externalDeviceId: raw.uniqueId,
    imei: raw.imei ?? null,
    latitude: raw.latitude,
    longitude: raw.longitude,
    speedKph: raw.speed !== undefined ? knotsToKph(raw.speed) : null,
    headingDeg: raw.course ?? null,
    altitudeM: raw.altitude ?? null,
    recordedAt: raw.fixTime
  };
}

/** Traccar reports speed in knots; RIO stores everything in km/h. */
function knotsToKph(knots: number): number {
  return Math.round(knots * 1.852 * 100) / 100;
}
