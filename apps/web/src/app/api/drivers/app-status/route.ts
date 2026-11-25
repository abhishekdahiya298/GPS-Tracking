import { NextResponse } from "next/server";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { listDriverAppStatus } from "@/lib/driver-app";
import { errorResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** GET: every driver's app state (sharing, location off, signed out, no app), battery and last report. */
export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "vehicles.read");
    return NextResponse.json({ drivers: await listDriverAppStatus(ctx.organizationId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "drivers.app_status" });
  }
}
