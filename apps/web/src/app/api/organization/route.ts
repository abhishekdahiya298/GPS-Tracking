import { NextResponse } from "next/server";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { getOrgSettings, OrgSettingsPatchSchema, updateOrgSettings } from "@/lib/organization";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

/** The caller's own organization only. */
export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    return NextResponse.json(await getOrgSettings(ctx.organizationId), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "organization.get" });
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "organization.manage");
    await updateOrgSettings(ctx, parseOrThrow(OrgSettingsPatchSchema, await readJson(request)), requestMeta(request));
    return NextResponse.json({ status: "updated" });
  } catch (err) {
    return errorResponse(err, { route: "organization.update" });
  }
}
