import { NextResponse } from "next/server";
import { authenticateDriver } from "@/lib/driver-app";
import { driverCompanies, driverRequests } from "@/lib/driver-links";
import { driverLoadRequests } from "@/lib/driver-loads";
import { errorResponse } from "@/lib/errors";
import { NO_STORE } from "../_shared";

export const dynamic = "force-dynamic";

/** GET (driver app, Bearer): companies asking to add the driver, those the driver works for, and loads waiting for an answer. */
export async function GET(request: Request) {
  try {
    const auth = await authenticateDriver(request);
    const [requests, companies, loads] = await Promise.all([driverRequests(auth), driverCompanies(auth), driverLoadRequests(auth)]);
    return NextResponse.json({ requests, companies, loads }, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err, { route: "driver_app.requests" });
  }
}
