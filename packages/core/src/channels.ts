/** Redis pub/sub channel names, centralized so producer (worker/API) and consumer (SSE) never drift. */
export function locationChannel(organizationId: string): string {
  return `rio:org:${organizationId}:locations`;
}

export function alertChannel(organizationId: string): string {
  return `rio:org:${organizationId}:alerts`;
}

/**
 * "Tracker is alive" pings for reports that carry no new current position (no GNSS fix, or a
 * late backlog record), so open live maps keep "last seen" and online/offline current.
 */
export function deviceSeenChannel(organizationId: string): string {
  return `rio:org:${organizationId}:seen`;
}
