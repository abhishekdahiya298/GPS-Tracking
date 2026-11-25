import { NextResponse } from "next/server";
import { authenticateDriver, signOutDriver } from "@/lib/driver-app";
import { errorResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** POST (driver app, Bearer): sign out on this phone (sharing stops; the company sees it). */
export async function POST(request: Request) {
  try {
    await signOutDriver(await authenticateDriver(request));
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err, { route: "driver_app.signout" });
  }
}
