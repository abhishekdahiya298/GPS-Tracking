import { contextHasPermission } from "@rio-gps/core";
import { NextResponse } from "next/server";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { errorResponse } from "@/lib/errors";
import { getServerEnv } from "@/lib/env";
import { DeviceListQuery, listDevicesPage, parseListQuery } from "@/lib/fleet-list";
import { listDevices } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

/** Devices of the caller's organization with their active vehicle assignment. Provider ids/IMEI are not exposed. */
export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "devices.read");
    const params = Object.fromEntries(new URL(request.url).searchParams);
    if (Object.keys(params).some((k) => k in DeviceListQuery.shape)) {
      const q = parseListQuery(DeviceListQuery, params);
      const page = await listDevicesPage(ctx.organizationId, q, new Date(), getServerEnv().GPS_DEVICE_OFFLINE_THRESHOLD_SECONDS, {
        includeImeiLast4: contextHasPermission(ctx, "devices.manage")
      });
      return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ devices: await listDevices(ctx.organizationId, { includeImeiLast4: contextHasPermission(ctx, "devices.manage") }) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "devices.list" });
  }
}
