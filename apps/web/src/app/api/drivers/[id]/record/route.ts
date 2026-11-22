import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { driverRecord } from "@/lib/drivers";
import { errorResponse, NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** A driver's vehicle history and last 7 days (scoped to the caller's organization). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "vehicles.read");
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Driver not found");
    return NextResponse.json(await driverRecord(ctx.organizationId, id), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "drivers.record" });
  }
}
