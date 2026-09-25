import { contextHasPermission } from "@rio-gps/core";
import { NextResponse } from "next/server";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { errorResponse } from "@/lib/errors";
import { listDevices } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

/** Devices of the caller's organization with their active vehicle assignment. Provider ids/IMEI are not exposed. */
export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "devices.read");
    return NextResponse.json({ devices: await listDevices(ctx.organizationId, { includeImeiLast4: contextHasPermission(ctx, "devices.manage") }) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "devices.list" });
  }
}
