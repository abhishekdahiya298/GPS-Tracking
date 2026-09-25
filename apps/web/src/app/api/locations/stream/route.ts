import { alertChannel, contextHasPermission, locationChannel } from "@rio-gps/core";
import { requireAuthenticatedUserFromHeaders, requirePermission, requireTenantContext, resolveTenantContext } from "@/lib/authz";
import { getServerEnv } from "@/lib/env";
import { AppError, errorResponse, TooManyRequestsError } from "@/lib/errors";
import { acquireStreamSlot, getLiveHub } from "@/lib/live-hub";
import { listCurrentLocations } from "@/lib/locations";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * SSE stream of live location updates for the caller's organization only.
 *
 * Protocol:
 *   event: snapshot  → { generatedAt, devices: CurrentDeviceLocation[] }   (first, on every (re)connect)
 *   event: location  → LiveLocationEvent                                   (each accepted newer fix)
 *   event: alert     → AlertEventDto (only with alerts.read)
 *   event: end       → { reason }                                          (server is closing; client should reconnect or re-login)
 *   : keep-alive comments every SSE_HEARTBEAT_SECONDS
 *
 * The snapshot makes reconnects lossless for the "current position" view without
 * server-side replay. The organization is derived from the session + memberships,
 * never from the request; the session is re-validated every SSE_SESSION_RECHECK_SECONDS
 * so sign-out or membership removal cuts the stream off.
 */
export async function GET(request: Request) {
  const env = getServerEnv();
  let ctx;
  let release: (() => void) | null = null;
  try {
    ctx = await requireTenantContext(request);
    requirePermission(ctx, "locations.read");
    release = acquireStreamSlot(ctx.userId, env.SSE_MAX_STREAMS_PER_USER);
    if (!release) throw new TooManyRequestsError("Too many open live streams");
  } catch (err) {
    return errorResponse(err, { route: "locations.stream" });
  }

  const { organizationId, userId } = ctx;
  const canSeeAlerts = contextHasPermission(ctx, "alerts.read");
  const channel = locationChannel(organizationId);
  const encoder = new TextEncoder();
  const timers: NodeJS.Timeout[] = [];
  let unsubscribe: (() => void) | null = null;
  let unsubscribeAlerts: (() => void) | null = null;
  let closed = false;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    timers.forEach((t) => clearInterval(t));
    unsubscribe?.();
    unsubscribeAlerts?.();
    release?.();
    try {
      controllerRef?.close();
    } catch {
      // already closed
    }
  };

  const send = (chunk: string) => {
    if (closed || !controllerRef) return;
    try {
      controllerRef.enqueue(encoder.encode(chunk));
    } catch {
      cleanup();
    }
  };
  const sendEvent = (event: string, data: unknown) => send(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const end = (reason: string) => {
    sendEvent("end", { reason });
    cleanup();
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controllerRef = controller;
      request.signal.addEventListener("abort", cleanup);
      try {
        // Subscribe before taking the snapshot so no update falls in between.
        unsubscribe = await getLiveHub().subscribe(channel, (message) => send(`event: location\ndata: ${message}\n\n`));
        if (canSeeAlerts) {
          unsubscribeAlerts = await getLiveHub().subscribe(alertChannel(organizationId), (message) => send(`event: alert\ndata: ${message}\n\n`));
        }
        send("retry: 5000\n\n");
        const now = new Date();
        const devices = await listCurrentLocations(organizationId, now, env.GPS_DEVICE_OFFLINE_THRESHOLD_SECONDS);
        sendEvent("snapshot", { generatedAt: now.toISOString(), devices });
      } catch (err) {
        logger.error("sse.start_failed", { organizationId }, err);
        end("unavailable");
        return;
      }

      timers.push(setInterval(() => send(": keep-alive\n\n"), env.SSE_HEARTBEAT_SECONDS * 1000));
      timers.push(
        setInterval(async () => {
          try {
            const user = await requireAuthenticatedUserFromHeaders(request.headers);
            const fresh = await resolveTenantContext(user);
            if (fresh.organizationId !== organizationId) end("organization_changed");
          } catch (err) {
            if (err instanceof AppError && (err.status === 401 || err.status === 403)) {
              end("session_ended");
            } else {
              // Transient failure (DB blip): close so the client reconnects and re-authenticates cleanly.
              logger.warn("sse.recheck_failed", { organizationId }, err);
              end("unavailable");
            }
          }
        }, env.SSE_SESSION_RECHECK_SECONDS * 1000)
      );
      timers.push(setInterval(() => end("max_lifetime"), env.SSE_MAX_LIFETIME_SECONDS * 1000));
      logger.debug("sse.opened", { organizationId, userId });
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
