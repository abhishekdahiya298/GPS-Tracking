import { describe, expect, it } from "vitest";
import { parseWebhookPosition, TraccarWebhookAuthError, TraccarWebhookPayloadError, verifyWebhookSecret } from "./webhook.js";

describe("verifyWebhookSecret", () => {
  it("passes with a matching bearer token", () => {
    expect(() => verifyWebhookSecret("Bearer s3cret", "s3cret")).not.toThrow();
  });

  it("throws TraccarWebhookAuthError when missing", () => {
    expect(() => verifyWebhookSecret(null, "s3cret")).toThrow(TraccarWebhookAuthError);
  });

  it("throws TraccarWebhookAuthError when mismatched", () => {
    expect(() => verifyWebhookSecret("Bearer wrong", "s3cret")).toThrow(TraccarWebhookAuthError);
  });
});

describe("parseWebhookPosition", () => {
  it("normalizes a Traccar forward.type=json payload", () => {
    const result = parseWebhookPosition({
      position: {
        deviceId: 1,
        valid: true,
        latitude: 43.69504,
        longitude: -79.86341,
        course: 40,
        fixTime: "2026-09-24T11:19:33.000+00:00"
      },
      device: { id: 1, uniqueId: "864361078566115" }
    });
    expect(result.externalDeviceId).toBe("864361078566115");
    expect(result.recordedAt.toISOString()).toBe("2026-09-24T11:19:33.000Z");
  });

  it("throws TraccarWebhookPayloadError on the old flat payload", () => {
    expect(() =>
      parseWebhookPosition({ deviceId: 1, uniqueId: "864361078566115", latitude: 1, longitude: 2, fixTime: "2026-01-01T00:00:00Z" })
    ).toThrow(TraccarWebhookPayloadError);
  });

  it("throws TraccarWebhookPayloadError on invalid payload", () => {
    expect(() => parseWebhookPosition({ foo: "bar" })).toThrow(TraccarWebhookPayloadError);
  });
});
