import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { recordService, ServiceInputSchema } from "@/lib/maintenance";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** Mark serviced: { servicedAt?, odometerKm?, note? } */
export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "maintenance.write");
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Maintenance item not found");
    await recordService(ctx, id, parseOrThrow(ServiceInputSchema, await readJson(request)), requestMeta(request));
    return NextResponse.json({ status: "serviced" }, { status: 201 });
  } catch (err) {
    return errorResponse(err, { route: "maintenance.service" });
  }
}
