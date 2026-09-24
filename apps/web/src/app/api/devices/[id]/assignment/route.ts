import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { readJson, requestMeta } from "@/lib/request-meta";
import { assignDevice, parseOrThrow, unassignDevice } from "@/lib/vehicles";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };
const BodySchema = z.object({ vehicleId: z.string().uuid() });

async function deviceId(params: Params["params"]) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Device not found");
  return id;
}

/** PUT { vehicleId } — assign (or move) the device to a vehicle. */
export async function PUT(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "devices.assign");
    const id = await deviceId(params);
    const { vehicleId } = parseOrThrow(BodySchema, await readJson(request));
    await assignDevice(ctx, id, vehicleId, requestMeta(request));
    return NextResponse.json({ status: "assigned" });
  } catch (err) {
    return errorResponse(err, { route: "devices.assign" });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "devices.unassign");
    await unassignDevice(ctx, await deviceId(params), requestMeta(request));
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err, { route: "devices.unassign" });
  }
}
