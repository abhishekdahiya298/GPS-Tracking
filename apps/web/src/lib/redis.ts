import Redis from "ioredis";

let publisher: Redis | null = null;

const READY_TIMEOUT_MS = 2_000;

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

/**
 * Returns the publisher once it is connected, waiting at most READY_TIMEOUT_MS.
 * With the offline queue disabled, a command issued while the (lazily created)
 * connection is still being established would fail immediately — e.g. the
 * first location publish after every web restart. Waiting briefly avoids that
 * without allowing unbounded queueing when Redis is genuinely down.
 */
export async function getReadyRedisPublisher(timeoutMs = READY_TIMEOUT_MS): Promise<Redis> {
  const client = getRedisPublisher();
  if (client.status === "ready") {
    return client;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Redis not ready within ${timeoutMs}ms (status: ${client.status})`));
    }, timeoutMs);
    const onReady = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(timer);
      client.off("ready", onReady);
    };
    client.on("ready", onReady);
  });
  return client;
}
