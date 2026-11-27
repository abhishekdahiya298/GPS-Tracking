import { NextResponse } from "next/server";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { driversForMap } from "@/lib/driver-app";
import { errorResponse } from "@/lib/errors";
import { openLoadsForDrivers } from "@/lib/loads";
import { contextHasPermission } from "@rio-gps/core";

export const dynamic = "force-dynamic";

/** GET: active drivers with where they are (truck tracker or phone) and their app status. */
export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "locations.read");
    requirePermission(ctx, "vehicles.read");
    const drivers = await driversForMap(ctx.organizationId);
    // Each card shows the driver's open load (A38), when this user may see loads.
    if (contextHasPermission(ctx, "loads.read") && drivers.length) {
      const loads = await openLoadsForDrivers(ctx.organizationId, drivers.map((d) => ({ id: d.id, phone: d.phone, vehicleId: d.vehicle?.id ?? null })));
      for (const d of drivers) d.load = loads.get(d.id) ?? null;
    }
    return NextResponse.json({ drivers }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "drivers.map" });
  }
}
