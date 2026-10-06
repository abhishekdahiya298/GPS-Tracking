import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { deleteRenewal, RenewalPatchSchema, updateRenewal } from "@/lib/renewals";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

async function renewalId(params: Params["params"]) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Renewal not found");
  return id;
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "maintenance.write");
    await updateRenewal(ctx, await renewalId(params), parseOrThrow(RenewalPatchSchema, await readJson(request)), requestMeta(request));
    return NextResponse.json({ status: "updated" });
  } catch (err) {
    return errorResponse(err, { route: "renewals.update" });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "maintenance.write");
    await deleteRenewal(ctx, await renewalId(params), requestMeta(request));
    return NextResponse.json({ status: "deleted" });
  } catch (err) {
    return errorResponse(err, { route: "renewals.delete" });
  }
}
