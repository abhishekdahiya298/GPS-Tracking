import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { requestDriverAgain } from "@/lib/driver-links";
import { errorResponse, NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** POST: ask the driver (again) to accept this company in their app. */
export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "vehicles.update");
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Driver not found");
    return NextResponse.json({ link: await requestDriverAgain(ctx.organizationId, id, ctx.userId) });
  } catch (err) {
    return errorResponse(err, { route: "drivers.request" });
  }
}
