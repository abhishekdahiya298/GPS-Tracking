import { locationChannel } from "@rio-gps/core";
import Redis from "ioredis";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { getServerEnv } from "@/lib/env";
import { errorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * SSE stream of live location updates for the caller's organization only.
 * The organization comes from the authenticated session + memberships
 * (lib/authz.ts), never from a query param — a client cannot subscribe to
 * another tenant's channel.
 */
export async function GET(request: Request) {
  let ctx;
  try {
    ctx = await requireTenantContext(request);
    requirePermission(ctx, "locations.read");
  } catch (err) {
    return errorResponse(err, { route: "locations.stream" });
  }

  const env = getServerEnv();
  const subscriber = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
  subscriber.on("error", (err) => logger.warn("sse.redis_error", { organizationId: ctx.organizationId }, err));
  const channel = locationChannel(ctx.organizationId);
  const encoder = new TextEncoder();
  let closed = false;
  let keepAlive: NodeJS.Timeout | undefined;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(keepAlive);
    subscriber.unsubscribe(channel).catch(() => undefined);
    subscriber.quit().catch(() => subscriber.disconnect());
  };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      subscriber.on("message", (_channel, message) => send(`event: location\ndata: ${message}\n\n`));
      try {
        await subscriber.subscribe(channel);
      } catch (err) {
        logger.error("sse.subscribe_failed", { organizationId: ctx.organizationId }, err);
        cleanup();
        controller.error(err);
        return;
      }

      send(`retry: 5000\n: connected\n\n`);
      keepAlive = setInterval(() => send(": keep-alive\n\n"), env.SSE_HEARTBEAT_SECONDS * 1000);

      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      cleanup();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
