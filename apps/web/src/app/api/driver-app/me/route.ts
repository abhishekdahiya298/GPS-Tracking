import { NextResponse } from "next/server";
import { authenticateDriver, driverMe } from "@/lib/driver-app";
import { errorResponse } from "@/lib/errors";
import { NO_STORE } from "../_shared";

export const dynamic = "force-dynamic";

/** GET (driver app, Bearer): who is signed in, their company and truck. */
export async function GET(request: Request) {
  try {
    return NextResponse.json(await driverMe(await authenticateDriver(request)), { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err, { route: "driver_app.me" });
  }
}
