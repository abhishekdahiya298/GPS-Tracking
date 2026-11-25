import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { signOutDriverEverywhere } from "@/lib/driver-app";
import { errorResponse, NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** POST: signs the driver out of the driver app on every phone (sharing stops). */
export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "vehicles.update");
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Driver not found");
    return NextResponse.json({ signedOut: await signOutDriverEverywhere(ctx.organizationId, id, ctx.userId) });
  } catch (err) {
    return errorResponse(err, { route: "drivers.app_signout" });
  }
}
