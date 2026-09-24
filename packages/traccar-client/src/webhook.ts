import { createHash, timingSafeEqual } from "node:crypto";
import { normalizePosition, TraccarForwardPayloadSchema, type NormalizedPosition } from "@rio-gps/core";

export class TraccarWebhookAuthError extends Error {}
export class TraccarWebhookPayloadError extends Error {}

/**
 * Verifies the shared-secret bearer token Traccar sends with every forward.
 * Uses a constant-time comparison (over fixed-length SHA-256 digests, so the
 * secret's length isn't leaked either). Throws rather than returning a boolean
 * so callers can't accidentally ignore a failed check.
 */
export function verifyWebhookSecret(authorizationHeader: string | null, expectedSecret: string): void {
  if (!expectedSecret) {
    throw new TraccarWebhookAuthError("Webhook secret is not configured");
  }
  const presented = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length) : "";
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expectedSecret).digest();
  if (!presented || !timingSafeEqual(a, b)) {
    throw new TraccarWebhookAuthError("Invalid or missing Traccar webhook credentials");
  }
}

/**
 * Parses and normalizes a Traccar `forward.type=json` body
 * (`{ position, device }`) into RIO's internal position shape.
 */
export function parseWebhookPosition(body: unknown): NormalizedPosition {
  const result = TraccarForwardPayloadSchema.safeParse(body);
  if (!result.success) {
    throw new TraccarWebhookPayloadError(result.error.message);
  }
  return normalizePosition(result.data);
}
