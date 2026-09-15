import Redis from "ioredis";

let publisher: Redis | null = null;

/** Shared Redis connection used to publish location updates for SSE fan-out. */
export function getRedisPublisher(): Redis {
  if (!publisher) {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error("REDIS_URL is not set");
    }
    publisher = new Redis(url);
  }
  return publisher;
}
