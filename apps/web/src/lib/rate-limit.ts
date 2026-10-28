import { TooManyRequestsError } from "./errors";
import { logger } from "./logger";
import { getReadyRedisPublisher } from "./redis";

/**
 * Fixed-window counter in Redis. Throws TooManyRequestsError over the limit.
 * If Redis is unavailable the request is allowed (and logged): these limits bound load
 * and cost, they are not what protects the data.
 */
export async function assertRateLimit(name: string, subject: string, limit: number, windowSeconds: number, message: string, now = Date.now()): Promise<void> {
  const key = `rl:${name}:${subject}:${Math.floor(now / (windowSeconds * 1000))}`;
  let n: number;
  try {
    const redis = await getReadyRedisPublisher();
    n = await redis.incr(key);
    if (n === 1) await redis.expire(key, windowSeconds + 30);
  } catch (err) {
    logger.warn("rate_limit.unavailable", { name }, err);
    return;
  }
  if (n > limit) throw new TooManyRequestsError(message);
}
