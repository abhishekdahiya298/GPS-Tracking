import Redis from "ioredis";

let publisher: Redis | null = null;

/**
 * Shared Redis connection used to publish location updates for SSE fan-out.
 * Commands fail fast (instead of queueing forever) while Redis is down so
 * callers can degrade gracefully; ioredis keeps reconnecting in the background.
 */
export function getRedisPublisher(): Redis {
  if (!publisher) {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error("REDIS_URL is not set");
    }
    publisher = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 5_000
    });
    publisher.on("error", () => {
      // Connection errors are surfaced to callers per command; avoid unhandled-error crashes.
    });
  }
  return publisher;
}
