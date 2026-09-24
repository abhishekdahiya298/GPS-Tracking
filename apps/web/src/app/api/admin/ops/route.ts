import { getDb, schema } from "@rio-gps/db";
import { count, gt, max, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/authz";
import { getServerEnv } from "@/lib/env";
import { errorResponse, ForbiddenError } from "@/lib/errors";
import { ingestSnapshot } from "@/lib/ingest-stats";
import { getLiveHub } from "@/lib/live-hub";
import { getReadyRedisPublisher } from "@/lib/redis";

export const dynamic = "force-dynamic";

async function timed<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  return Promise.race([fn(), new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

/**
 * Platform operations snapshot for SUPER_ADMIN only: dependency health, ingest
 * freshness and live-stream load. Aggregates only; no locations or tenant data.
 */
export async function GET(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    if (!user.isSuperAdmin) throw new ForbiddenError();
    const env = getServerEnv();
    const db = getDb();
    const now = Date.now();

    const dbCheck = await timed(async () => {
      const onlineSince = new Date(now - env.GPS_DEVICE_OFFLINE_THRESHOLD_SECONDS * 1000);
      const [dev] = await db
        .select({ total: count(), online: sql<number>`count(*) filter (where ${schema.gpsDevices.lastSeenAt} > ${onlineSince.toISOString()}::timestamptz)::int` })
        .from(schema.gpsDevices);
      const [hist] = await db
        .select({ last: max(schema.locationHistory.receivedAt), lastDay: count() })
        .from(schema.locationHistory)
        .where(gt(schema.locationHistory.receivedAt, new Date(now - 86_400_000)));
      const [orgs] = await db.select({ n: count() }).from(schema.organizations);
      return { devices: dev, lastHistoryReceivedAt: hist?.last ?? null, historyRowsLast24h: hist?.lastDay ?? 0, organizations: orgs?.n ?? 0 };
    }, 3000).then(
      (r) => ({ ok: true as const, ...r }),
      () => ({ ok: false as const })
    );
    const redisOk = await timed(async () => (await getReadyRedisPublisher()).ping(), 3000).then(
      () => true,
      () => false
    );

    return NextResponse.json(
      {
        generatedAt: new Date(now).toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
        database: dbCheck,
        redis: { ok: redisOk },
        ingest: ingestSnapshot(),
        liveStreams: getLiveHub().stats()
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return errorResponse(err, { route: "admin.ops" });
  }
}
