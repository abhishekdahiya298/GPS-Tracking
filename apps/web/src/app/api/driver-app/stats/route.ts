import { NextResponse } from "next/server";
import { authenticateDriver } from "@/lib/driver-app";
import { driverStats, STATS_RANGES, type StatsRange } from "@/lib/driver-links";
import { errorResponse } from "@/lib/errors";
import { NO_STORE } from "../_shared";

export const dynamic = "force-dynamic";

/** GET ?range=today|week|month (driver app, Bearer): how much the driver drove. */
export async function GET(request: Request) {
  try {
    const auth = await authenticateDriver(request);
    const r = new URL(request.url).searchParams.get("range") ?? "today";
    const range: StatsRange = (STATS_RANGES as readonly string[]).includes(r) ? (r as StatsRange) : "today";
    return NextResponse.json(await driverStats(auth, range), { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err, { route: "driver_app.stats" });
  }
}
