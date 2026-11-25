import { NextResponse } from "next/server";
import { authenticateDriver, PushTokenSchema, setDriverPushToken } from "@/lib/driver-app";
import { errorResponse } from "@/lib/errors";
import { readJson } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

/** PUT {token|null} (driver app, Bearer): this phone's push address, so the company can reach the driver. */
export async function PUT(request: Request) {
  try {
    const auth = await authenticateDriver(request);
    const { token } = parseOrThrow(PushTokenSchema, await readJson(request));
    await setDriverPushToken(auth, token);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err, { route: "driver_app.push" });
  }
}
