import { TraccarRestClient } from "@rio-gps/traccar-client";

/** Minimal surface used by RIO's admin flows; swappable in tests. */
export interface TraccarAdmin {
  ensureDevice(name: string, uniqueId: string): Promise<{ device: { id: number; uniqueId: string }; created: boolean }>;
}

let override: TraccarAdmin | null = null;
export function setTraccarAdminForTests(t: TraccarAdmin | null) {
  override = t;
}

export class TraccarNotConfiguredError extends Error {}

export function getTraccarAdmin(): TraccarAdmin {
  if (override) return override;
  const { TRACCAR_API_URL, TRACCAR_API_USER, TRACCAR_API_PASSWORD } = process.env;
  if (!TRACCAR_API_URL || !TRACCAR_API_USER || !TRACCAR_API_PASSWORD) {
    throw new TraccarNotConfiguredError("Traccar API credentials are not configured");
  }
  return new TraccarRestClient({ baseUrl: TRACCAR_API_URL, username: TRACCAR_API_USER, password: TRACCAR_API_PASSWORD });
}
