import { NextResponse } from "next/server";
import { createGeofence, GeofenceInputSchema, listGeofences } from "@/lib/alerts";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "geofences.read");
    return NextResponse.json({ geofences: await listGeofences(ctx.organizationId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "geofences.list" });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "geofences.write");
    const input = parseOrThrow(GeofenceInputSchema, await readJson(request));
    return NextResponse.json({ geofence: await createGeofence(ctx, input, requestMeta(request)) }, { status: 201 });
  } catch (err) {
    return errorResponse(err, { route: "geofences.create" });
  }
}
