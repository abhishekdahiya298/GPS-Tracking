import { NextResponse } from "next/server";
import { authenticateDriver, DriverReportSchema, recordDriverReport } from "@/lib/driver-app";
import { errorResponse } from "@/lib/errors";
import { assertRateLimit } from "@/lib/rate-limit";
import { readJson } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";
import { NO_STORE } from "../_shared";

export const dynamic = "force-dynamic";

/**
 * POST (driver app, Bearer): { points: [...], battery, permission, locationEnabled } — the phone's
 * latest points (queued ones included, up to 500) and its status. A report with no points is a
 * heartbeat (battery, permission).
 */
export async function POST(request: Request) {
  try {
    const auth = await authenticateDriver(request);
    await assertRateLimit("driver_app_report", auth.driverId, 240, 3600, "Too many reports. Try again in a minute.");
    const body = parseOrThrow(DriverReportSchema, await readJson(request));
    return NextResponse.json(await recordDriverReport(auth, body), { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err, { route: "driver_app.report" });
  }
}
