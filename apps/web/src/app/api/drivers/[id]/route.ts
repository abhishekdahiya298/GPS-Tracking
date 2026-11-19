import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { deleteDriver, DriverPatchSchema, updateDriver } from "@/lib/drivers";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

async function driverId(params: Params["params"]) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Driver not found");
  return id;
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "vehicles.update");
    const d = await updateDriver(ctx, await driverId(params), parseOrThrow(DriverPatchSchema, await readJson(request)), requestMeta(request));
    return NextResponse.json({ driver: { id: d.id, name: d.name } });
  } catch (err) {
    return errorResponse(err, { route: "drivers.update" });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "vehicles.delete");
    await deleteDriver(ctx, await driverId(params), requestMeta(request));
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err, { route: "drivers.delete" });
  }
}
