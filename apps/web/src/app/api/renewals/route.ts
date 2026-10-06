import { NextResponse } from "next/server";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { createRenewal, listRenewals, RenewalInputSchema } from "@/lib/renewals";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "maintenance.read");
    return NextResponse.json({ renewals: await listRenewals(ctx.organizationId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "renewals.list" });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "maintenance.write");
    const id = await createRenewal(ctx, parseOrThrow(RenewalInputSchema, await readJson(request)), requestMeta(request));
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return errorResponse(err, { route: "renewals.create" });
  }
}
