import { NextResponse } from "next/server";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { createShipperLink, revokeShipperLink } from "@/lib/loads";
import { requestMeta } from "@/lib/request-meta";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** A read-only tracking link for the shipper (replaces any earlier one), returned once. */
export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "loads.write");
    return NextResponse.json(await createShipperLink(ctx, (await params).id, requestMeta(request)), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "loads.shipper_link.create" });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "loads.write");
    await revokeShipperLink(ctx, (await params).id, requestMeta(request));
    return NextResponse.json({ status: "revoked" });
  } catch (err) {
    return errorResponse(err, { route: "loads.shipper_link.revoke" });
  }
}
