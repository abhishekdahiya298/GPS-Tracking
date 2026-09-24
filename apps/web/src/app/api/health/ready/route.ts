import { getDb } from "@rio-gps/db";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getRedisPublisher } from "@/lib/redis";

export const dynamic = "force-dynamic";

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Readiness: can this instance serve real traffic right now? Checks the
 * dependencies a request actually needs. Liveness (/api/health) deliberately
 * does NOT check these, so a database blip doesn't cause restart loops.
 * Reports only ok/fail per dependency — never hosts, versions or error text.
 */
export async function GET() {
  const checks: Record<string, "ok" | "fail"> = {};

  await Promise.all([
    withTimeout(getDb().execute(sql`select 1`), 2_000)
      .then(() => {
        checks.postgres = "ok";
      })
      .catch((err) => {
        checks.postgres = "fail";
        logger.warn("health.ready.postgres_failed", {}, err);
      }),
    withTimeout(getRedisPublisher().ping(), 2_000)
      .then(() => {
        checks.redis = "ok";
      })
      .catch((err) => {
        checks.redis = "fail";
        logger.warn("health.ready.redis_failed", {}, err);
      })
  ]);

  const ready = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json(
    { status: ready ? "ready" : "not_ready", checks, timestamp: new Date().toISOString() },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
