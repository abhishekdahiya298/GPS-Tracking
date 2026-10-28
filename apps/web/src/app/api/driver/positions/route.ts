import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { DriverPingSchema, recordDriverPositions } from "@/lib/load-public";
import { assertRateLimit } from "@/lib/rate-limit";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";
import { notAvailable, PUBLIC_HEADERS } from "../_shared";

export const dynamic = "force-dynamic";

/**
 * PUBLIC: positions from the driver's phone, { token, positions: [...] } (1 to 100, queued
 * ones included). Accepted only while the driver is sharing on a load that has not ended.
 */
export async function POST(request: Request) {
  try {
    await assertRateLimit("driver_pos", requestMeta(request).ipAddress ?? "unknown", 60, 60, "Too many requests. Try again in a minute.");
    const body = parseOrThrow(DriverPingSchema, await readJson(request));
    const result = await recordDriverPositions(body.token, body);
    return result ? NextResponse.json(result, { headers: PUBLIC_HEADERS }) : notAvailable();
  } catch (err) {
    return errorResponse(err, { route: "driver.positions" });
  }
}
