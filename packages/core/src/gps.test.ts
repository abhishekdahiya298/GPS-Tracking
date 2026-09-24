import { describe, expect, it } from "vitest";
import { isUsableFix, normalizePosition, TraccarForwardPayloadSchema } from "./gps.js";

/**
 * Shape of a real Traccar 6.15.3 `forward.type=json` body for the FTM880
 * (IMEI 864361078566115); coordinates/course match a position Traccar logged
 * on 2026-09-24 11:19:33 UTC.
 */
export const ftm880Payload = {
  position: {
    id: 12403,
    attributes: { priority: 0, sat: 12, event: 0, ignition: true, motion: false, power: 14.654, battery: 4.119 },
    deviceId: 1,
    protocol: "teltonika",
    serverTime: "2026-09-24T11:20:40.123+00:00",
    deviceTime: "2026-09-24T11:19:33.000+00:00",
    fixTime: "2026-09-24T11:19:33.000+00:00",
    outdated: false,
    valid: true,
    latitude: 43.69504,
    longitude: -79.86341,
    altitude: 245,
    speed: 0,
    course: 40,
    accuracy: 0
  },
  device: {
    id: 1,
    attributes: {},
    groupId: 0,
    calendarId: 0,
    name: "FTM880-6115",
    uniqueId: "864361078566115",
    status: "online",
    lastUpdate: "2026-09-24T11:20:40.123+00:00",
    positionId: 12403,
    disabled: false
  }
};

describe("normalizePosition", () => {
  it("normalizes a Traccar JSON forward payload using the IMEI, not Traccar's internal ids", () => {
    const normalized = normalizePosition(TraccarForwardPayloadSchema.parse(ftm880Payload));

    expect(normalized.externalDeviceId).toBe("864361078566115");
    expect(normalized.imei).toBe("864361078566115");
    expect(normalized.latitude).toBe(43.69504);
    expect(normalized.longitude).toBe(-79.86341);
    expect(normalized.headingDeg).toBe(40);
    expect(normalized.altitudeM).toBe(245);
    expect(normalized.speedKph).toBe(0);
    expect(normalized.recordedAt.toISOString()).toBe("2026-09-24T11:19:33.000Z");
    expect(normalized.valid).toBe(true);
    expect(normalized.ignition).toBe(true);
    expect(normalized.motion).toBe(false);
    expect(JSON.stringify(normalized)).not.toContain("12403");
  });

  it("converts knots to km/h", () => {
    const payload = { ...ftm880Payload, position: { ...ftm880Payload.position, speed: 10 } };
    expect(normalizePosition(TraccarForwardPayloadSchema.parse(payload)).speedKph).toBeCloseTo(18.52, 2);
  });

  it("does not treat a non-IMEI uniqueId as an IMEI", () => {
    const payload = { ...ftm880Payload, device: { ...ftm880Payload.device, uniqueId: "demo-1" } };
    expect(normalizePosition(TraccarForwardPayloadSchema.parse(payload)).imei).toBeNull();
  });

  it("rejects out-of-range latitude", () => {
    const payload = { ...ftm880Payload, position: { ...ftm880Payload.position, latitude: 999 } };
    expect(() => TraccarForwardPayloadSchema.parse(payload)).toThrow();
  });

  it("rejects the old flat payload shape", () => {
    expect(() => TraccarForwardPayloadSchema.parse(ftm880Payload.position)).toThrow();
  });
});

describe("isUsableFix", () => {
  const base = normalizePosition(TraccarForwardPayloadSchema.parse(ftm880Payload));

  it("accepts a valid fix", () => {
    expect(isUsableFix(base)).toBe(true);
  });

  it("rejects records without a GNSS fix", () => {
    expect(isUsableFix({ ...base, valid: false })).toBe(false);
  });

  it("rejects the 0,0 placeholder", () => {
    expect(isUsableFix({ ...base, latitude: 0, longitude: 0 })).toBe(false);
  });
});
