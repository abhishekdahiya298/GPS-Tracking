import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { RenewInputSchema, renewRenewal } from "@/lib/renewals";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

/** Mark as renewed with the next due date. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "maintenance.write");
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Renewal not found");
    await renewRenewal(ctx, id, parseOrThrow(RenewInputSchema, await readJson(request)), requestMeta(request));
    return NextResponse.json({ status: "renewed" });
  } catch (err) {
    return errorResponse(err, { route: "renewals.renew" });
  }
}
