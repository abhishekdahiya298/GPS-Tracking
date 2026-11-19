import { NextResponse } from "next/server";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { createDriver, DriverInputSchema, DriverListQuery, listDriversPage } from "@/lib/drivers";
import { errorResponse } from "@/lib/errors";
import { parseListQuery } from "@/lib/fleet-list";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

/** Drivers, paged and searchable. Drivers are part of the fleet: vehicle permissions apply. */
export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "vehicles.read");
    const q = parseListQuery(DriverListQuery, Object.fromEntries(new URL(request.url).searchParams));
    return NextResponse.json(await listDriversPage(ctx.organizationId, q), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "drivers.list" });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "vehicles.create");
    const d = await createDriver(ctx, parseOrThrow(DriverInputSchema, await readJson(request)), requestMeta(request));
    return NextResponse.json({ driver: { id: d.id, name: d.name } }, { status: 201 });
  } catch (err) {
    return errorResponse(err, { route: "drivers.create" });
  }
}
