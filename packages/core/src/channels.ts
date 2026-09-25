/** Redis pub/sub channel names, centralized so producer (worker/API) and consumer (SSE) never drift. */
export function locationChannel(organizationId: string): string {
  return `rio:org:${organizationId}:locations`;
}

export function alertChannel(organizationId: string): string {
  return `rio:org:${organizationId}:alerts`;
}
