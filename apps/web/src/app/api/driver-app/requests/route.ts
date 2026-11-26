import { NextResponse } from "next/server";
import { authenticateDriver } from "@/lib/driver-app";
import { driverCompanies, driverRequests } from "@/lib/driver-links";
import { errorResponse } from "@/lib/errors";
import { NO_STORE } from "../_shared";

export const dynamic = "force-dynamic";

/** GET (driver app, Bearer): companies asking to add the driver, and those the driver works for. */
export async function GET(request: Request) {
  try {
    const auth = await authenticateDriver(request);
    const [requests, companies] = await Promise.all([driverRequests(auth), driverCompanies(auth)]);
    return NextResponse.json({ requests, companies }, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err, { route: "driver_app.requests" });
  }
}
