import { NextResponse } from "next/server";
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
