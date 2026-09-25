import { contextHasPermission } from "@rio-gps/core";
import { NextResponse } from "next/server";
import { listEvents } from "@/lib/alerts";
import { getServerEnv } from "@/lib/env";
import { getVehicleDetail } from "@/lib/fleet-list";
import { z } from "zod";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { readJson, requestMeta } from "@/lib/request-meta";
import { deleteVehicle, parseOrThrow, updateVehicle, VehiclePatchSchema } from "@/lib/vehicles";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

async function vehicleId(params: Params["params"]) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Vehicle not found");
  return id;
}

/** Vehicle detail: current device + position; recent alerts when allowed. */
export async function GET(request: Request, { params }: Params) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "vehicles.read");
    const id = await vehicleId(params);
    const detail = await getVehicleDetail(ctx.organizationId, id, new Date(), getServerEnv().GPS_DEVICE_OFFLINE_THRESHOLD_SECONDS, {
      includeImeiLast4: contextHasPermission(ctx, "devices.manage")
    });
    if (!detail) throw new NotFoundError("Vehicle not found");
    if (!contextHasPermission(ctx, "locations.read")) detail.location = null;
    const alerts = contextHasPermission(ctx, "alerts.read") ? await listEvents(ctx.organizationId, { limit: 5, unacknowledgedOnly: false, vehicleId: id }) : [];
    return NextResponse.json({ ...detail, alerts }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "vehicles.get" });
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "vehicles.update");
    const id = await vehicleId(params);
    const patch = parseOrThrow(VehiclePatchSchema, await readJson(request));
    const v = await updateVehicle(ctx, id, patch, requestMeta(request));
    return NextResponse.json({ vehicle: { id: v.id, name: v.name, licensePlate: v.licensePlate, status: v.status } });
  } catch (err) {
    return errorResponse(err, { route: "vehicles.update" });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "vehicles.delete");
    await deleteVehicle(ctx, await vehicleId(params), requestMeta(request));
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err, { route: "vehicles.delete" });
  }
}
