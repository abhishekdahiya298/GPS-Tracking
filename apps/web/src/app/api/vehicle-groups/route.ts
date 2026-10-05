import { NextResponse } from "next/server";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { readJson, requestMeta } from "@/lib/request-meta";
import { createGroup, GroupInputSchema, listGroups } from "@/lib/vehicle-groups";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

/** The caller's own organization's groups (vehicles.read). */
export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "vehicles.read");
    return NextResponse.json({ groups: await listGroups(ctx.organizationId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "vehicle_groups.list" });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "vehicles.update");
    const group = await createGroup(ctx, parseOrThrow(GroupInputSchema, await readJson(request)), requestMeta(request));
    return NextResponse.json({ group }, { status: 201 });
  } catch (err) {
    return errorResponse(err, { route: "vehicle_groups.create" });
  }
}
