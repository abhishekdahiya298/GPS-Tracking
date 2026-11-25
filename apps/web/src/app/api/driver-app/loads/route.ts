import { NextResponse } from "next/server";
import { authenticateDriver, driverLoads } from "@/lib/driver-app";
import { errorResponse } from "@/lib/errors";
import { NO_STORE } from "../_shared";

export const dynamic = "force-dynamic";

/** GET (driver app, Bearer): the driver's open loads and those delivered in the last day. */
export async function GET(request: Request) {
  try {
    return NextResponse.json({ loads: await driverLoads(await authenticateDriver(request)) }, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err, { route: "driver_app.loads" });
  }
}
