import { NextResponse } from "next/server";
import { z } from "zod";
import { AlertRulePatchSchema, deleteRule, updateRule } from "@/lib/alerts";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

async function idOf(params: Params["params"]) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Alert rule not found");
  return id;
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "alerts.write");
    await updateRule(ctx, await idOf(params), parseOrThrow(AlertRulePatchSchema, await readJson(request)), requestMeta(request));
    return NextResponse.json({ status: "updated" });
  } catch (err) {
    return errorResponse(err, { route: "alert_rules.update" });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "alerts.write");
    await deleteRule(ctx, await idOf(params), requestMeta(request));
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err, { route: "alert_rules.delete" });
  }
}
