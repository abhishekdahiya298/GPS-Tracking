import { NextResponse } from "next/server";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { driversForMap } from "@/lib/driver-app";
import { errorResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** GET: active drivers with where they are (truck tracker or phone) and their app status. */
export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "locations.read");
    requirePermission(ctx, "vehicles.read");
    return NextResponse.json({ drivers: await driversForMap(ctx.organizationId) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "drivers.map" });
  }
}
