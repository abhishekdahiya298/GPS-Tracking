import { normalizePosition, TraccarWebhookPositionSchema, type NormalizedPosition } from "@rio-gps/core";

export class TraccarWebhookAuthError extends Error {}
export class TraccarWebhookPayloadError extends Error {}

/**
 * Verifies the shared-secret bearer token Traccar (or a forwarding shim in front
 * of it) is expected to send with every webhook call. Throws rather than returning
 * a boolean so callers can't accidentally ignore a failed check.
 */
export function verifyWebhookSecret(authorizationHeader: string | null, expectedSecret: string): void {
  const expected = `Bearer ${expectedSecret}`;
  if (!authorizationHeader || authorizationHeader !== expected) {
    throw new TraccarWebhookAuthError("Invalid or missing Traccar webhook credentials");
  }
}

/** Parses and normalizes a raw webhook request body into RIO's internal position shape. */
export function parseWebhookPosition(body: unknown): NormalizedPosition {
  const result = TraccarWebhookPositionSchema.safeParse(body);
  if (!result.success) {
    throw new TraccarWebhookPayloadError(result.error.message);
  }
  return normalizePosition(result.data);
}
