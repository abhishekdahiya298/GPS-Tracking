import Redis from "ioredis";
import { getServerEnv } from "./env";
import { logger } from "./logger";

type Listener = (message: string) => void;

/**
 * One Redis subscriber per web process, fanned out in memory to SSE clients.
 * Channels are reference-counted: subscribed on first listener, unsubscribed on
 * last. Listeners are keyed by the exact channel string, which is always built
 * from a server-derived organizationId (never client input).
 */
class LiveHub {
  private subscriber: Redis | null = null;
  private listeners = new Map<string, Set<Listener>>();

  private client(): Redis {
    if (!this.subscriber) {
      const sub = new Redis(getServerEnv().REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
      sub.on("message", (channel: string, message: string) => {
        const set = this.listeners.get(channel);
        if (!set) return;
        for (const fn of set) {
          try {
            fn(message);
          } catch (err) {
            logger.warn("sse.listener_failed", { channel }, err);
          }
        }
      });
      sub.on("error", (err) => logger.warn("sse.redis_error", {}, err));
      // ioredis re-subscribes to all channels automatically after a reconnect.
      this.subscriber = sub;
    }
    return this.subscriber;
  }

  /** Subscribes `fn` to `channel`; resolves once Redis confirmed the subscription. Returns an unsubscribe function. */
  async subscribe(channel: string, fn: Listener): Promise<() => void> {
    let set = this.listeners.get(channel);
    const first = !set;
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
    }
    set.add(fn);
    if (first) {
      try {
        await this.client().subscribe(channel);
      } catch (err) {
        set.delete(fn);
        if (set.size === 0) this.listeners.delete(channel);
        throw err;
      }
    }
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const s = this.listeners.get(channel);
      if (!s) return;
      s.delete(fn);
      if (s.size === 0) {
        this.listeners.delete(channel);
        this.client()
          .unsubscribe(channel)
          .catch((err) => logger.warn("sse.unsubscribe_failed", { channel }, err));
      }
    };
  }

  stats() {
    let listeners = 0;
    for (const s of this.listeners.values()) listeners += s.size;
    return { channels: this.listeners.size, listeners };
  }
}

const globalForHub = globalThis as unknown as { __rioLiveHub?: LiveHub };
export function getLiveHub(): LiveHub {
  globalForHub.__rioLiveHub ??= new LiveHub();
  return globalForHub.__rioLiveHub;
}

/** In-process concurrent-stream counter per user (web runs as a single instance). */
const openStreams = new Map<string, number>();
export function acquireStreamSlot(userId: string, max: number): (() => void) | null {
  const n = openStreams.get(userId) ?? 0;
  if (n >= max) return null;
  openStreams.set(userId, n + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const cur = (openStreams.get(userId) ?? 1) - 1;
    if (cur <= 0) openStreams.delete(userId);
    else openStreams.set(userId, cur);
  };
}
