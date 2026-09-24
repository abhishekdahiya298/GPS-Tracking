import { z } from "zod";

/**
 * Shape of the body Traccar POSTs to `forward.url` when `forward.type=json`
 * (Traccar 6.x `PositionForwarderJson`, which serializes `PositionData`):
 *
 *   { "position": { ...org.traccar.model.Position }, "device": { ...org.traccar.model.Device } }
 *
 * Dates are ISO-8601 strings (Traccar's ObjectMapper disables timestamp output).
 * Only the fields RIO uses are validated; everything else passes through untouched.
 * Traccar's numeric ids (`position.id`, `position.deviceId`, `device.id`) are
 * provider-internal and never leave this module's normalization step.
 */
export const TraccarForwardPositionSchema = z
  .object({
    deviceId: z.number().int(),
    fixTime: z.coerce.date(),
    valid: z.boolean().optional(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    altitude: z.number().optional(),
    speed: z.number().min(0).optional(),
    course: z.number().min(0).max(360).optional(),
    attributes: z.record(z.unknown()).optional()
  })
  .passthrough();

export const TraccarForwardDeviceSchema = z
  .object({
    id: z.number().int(),
    uniqueId: z.string().min(1)
  })
  .passthrough();

export const TraccarForwardPayloadSchema = z.object({
  position: TraccarForwardPositionSchema,
  device: TraccarForwardDeviceSchema
});

export type TraccarForwardPayload = z.infer<typeof TraccarForwardPayloadSchema>;

/** RIO's internal, provider-agnostic representation of a device position. */
export interface NormalizedPosition {
  externalDeviceId: string;
  imei: string | null;
  latitude: number;
  longitude: number;
  speedKph: number | null;
  headingDeg: number | null;
  altitudeM: number | null;
  /** GNSS fix time reported by the device (UTC). */
  recordedAt: Date;
  /** false when the device had no GNSS fix for this record. */
  valid: boolean;
  ignition: boolean | null;
  motion: boolean | null;
}

const IMEI_PATTERN = /^\d{15}$/;

/** Converts a Traccar JSON forward payload into RIO's normalized position shape. */
export function normalizePosition(raw: TraccarForwardPayload): NormalizedPosition {
  const { position, device } = raw;
  const attributes = position.attributes ?? {};
  return {
    externalDeviceId: device.uniqueId,
    // Teltonika (and most trackers) identify by IMEI, which Traccar stores as uniqueId.
    imei: IMEI_PATTERN.test(device.uniqueId) ? device.uniqueId : null,
    latitude: position.latitude,
    longitude: position.longitude,
    speedKph: position.speed !== undefined ? knotsToKph(position.speed) : null,
    headingDeg: position.course ?? null,
    altitudeM: position.altitude ?? null,
    recordedAt: position.fixTime,
    valid: position.valid ?? true,
    ignition: typeof attributes.ignition === "boolean" ? attributes.ignition : null,
    motion: typeof attributes.motion === "boolean" ? attributes.motion : null
  };
}

/**
 * A record is only usable as a location if the device had a GNSS fix and the
 * coordinates are not the 0,0 placeholder trackers emit before first fix.
 */
export function isUsableFix(position: NormalizedPosition): boolean {
  return position.valid && !(position.latitude === 0 && position.longitude === 0);
}

/** Traccar reports speed in knots; RIO stores everything in km/h. */
function knotsToKph(knots: number): number {
  return Math.round(knots * 1.852 * 100) / 100;
}
