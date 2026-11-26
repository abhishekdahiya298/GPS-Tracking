import { NextResponse } from "next/server";
import { authenticateDriver, driverMe } from "@/lib/driver-app";
import { ProfileSchema, updateDriverProfile } from "@/lib/driver-links";
import { errorResponse } from "@/lib/errors";
import { readJson } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";
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

/** PATCH {name?, email?, licenseNumber?, licenseExpiresOn?} (driver app, Bearer): the driver edits their profile. */
export async function PATCH(request: Request) {
  try {
    const auth = await authenticateDriver(request);
    await updateDriverProfile(auth, parseOrThrow(ProfileSchema, await readJson(request)));
    return NextResponse.json(await driverMe(auth), { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err, { route: "driver_app.me_update" });
  }
}
