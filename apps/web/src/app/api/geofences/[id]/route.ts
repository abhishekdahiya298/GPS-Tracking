import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteGeofence, GeofencePatchSchema, updateGeofence } from "@/lib/alerts";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

async function idOf(params: Params["params"]) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Geofence not found");
  return id;
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "geofences.write");
    await updateGeofence(ctx, await idOf(params), parseOrThrow(GeofencePatchSchema, await readJson(request)), requestMeta(request));
    return NextResponse.json({ status: "updated" });
  } catch (err) {
    return errorResponse(err, { route: "geofences.update" });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "geofences.write");
    await deleteGeofence(ctx, await idOf(params), requestMeta(request));
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err, { route: "geofences.delete" });
  }
}
