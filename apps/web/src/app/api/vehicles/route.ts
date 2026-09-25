import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { listVehiclesPage, parseListQuery, VehicleListQuery } from "@/lib/fleet-list";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { readJson, requestMeta } from "@/lib/request-meta";
import { createVehicle, listVehicles, parseOrThrow, VehicleInputSchema } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "vehicles.read");
    const params = Object.fromEntries(new URL(request.url).searchParams);
    // Paged/searchable form: ?page=&pageSize=&search=&sort=&direction=&state=
    if (Object.keys(params).some((k) => k in VehicleListQuery.shape)) {
      const q = parseListQuery(VehicleListQuery, params);
      const page = await listVehiclesPage(ctx.organizationId, q, new Date(), getServerEnv().GPS_DEVICE_OFFLINE_THRESHOLD_SECONDS);
      return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ vehicles: await listVehicles(ctx.organizationId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "vehicles.list" });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "vehicles.create");
    const input = parseOrThrow(VehicleInputSchema, await readJson(request));
    const v = await createVehicle(ctx, input, requestMeta(request));
    return NextResponse.json({ vehicle: { id: v.id, name: v.name, licensePlate: v.licensePlate, status: v.status } }, { status: 201 });
  } catch (err) {
    return errorResponse(err, { route: "vehicles.create" });
  }
}
