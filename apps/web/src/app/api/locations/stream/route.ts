import { locationChannel } from "@rio-gps/core";
import Redis from "ioredis";
import { getAuthenticatedSession, UnauthenticatedError } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * SSE stream of live location updates for the caller's organization only.
 * organizationId always comes from the authenticated session (see lib/tenant.ts),
 * never from a query param — a client cannot subscribe to another tenant's feed.
 */
export async function GET(request: Request) {
  let session;
  try {
    session = await getAuthenticatedSession(request);
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return new Response("Unauthorized", { status: 401 });
    }
    throw err;
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return new Response("Server misconfigured", { status: 500 });
  }

  const subscriber = new Redis(redisUrl);
  const channel = locationChannel(session.organizationId);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      await subscriber.subscribe(channel);
      subscriber.on("message", (_channel, message) => {
        controller.enqueue(encoder.encode(`data: ${message}\n\n`));
      });

      const keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, 15000);

      request.signal.addEventListener("abort", () => {
        clearInterval(keepAlive);
        subscriber.quit();
        controller.close();
      });
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
