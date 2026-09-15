import { describe, expect, it } from "vitest";
import { normalizePosition, TraccarWebhookPositionSchema } from "./gps.js";

describe("normalizePosition", () => {
  it("converts a valid Traccar webhook payload into RIO's normalized shape", () => {
    const raw = TraccarWebhookPositionSchema.parse({
      deviceId: 42,
      imei: "352625690123456",
      uniqueId: "352625690123456",
      latitude: 12.9716,
      longitude: 77.5946,
      speed: 10,
      course: 180,
      altitude: 900,
      fixTime: "2026-01-01T00:00:00.000Z"
    });

    const normalized = normalizePosition(raw);

    expect(normalized.externalDeviceId).toBe("352625690123456");
    expect(normalized.imei).toBe("352625690123456");
    expect(normalized.speedKph).toBeCloseTo(18.52, 2);
    expect(normalized.headingDeg).toBe(180);
    expect(normalized.recordedAt).toBeInstanceOf(Date);
  });

  it("rejects out-of-range latitude", () => {
    expect(() =>
      TraccarWebhookPositionSchema.parse({
        deviceId: 1,
        uniqueId: "x",
        latitude: 999,
        longitude: 0,
        fixTime: "2026-01-01T00:00:00.000Z"
      })
    ).toThrow();
  });
});
