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
  it("normalizes a valid payload", () => {
    const result = parseWebhookPosition({
      deviceId: 1,
      uniqueId: "352625690123456",
      latitude: 1,
      longitude: 2,
      fixTime: "2026-01-01T00:00:00.000Z"
    });
    expect(result.externalDeviceId).toBe("352625690123456");
  });

  it("throws TraccarWebhookPayloadError on invalid payload", () => {
    expect(() => parseWebhookPosition({ foo: "bar" })).toThrow(TraccarWebhookPayloadError);
  });
});
