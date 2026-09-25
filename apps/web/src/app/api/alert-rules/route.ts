import { NextResponse } from "next/server";
import { AlertRuleInputSchema, createRule, listRules } from "@/lib/alerts";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "alerts.read");
    return NextResponse.json({ rules: await listRules(ctx.organizationId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "alert_rules.list" });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "alerts.write");
    const id = await createRule(ctx, parseOrThrow(AlertRuleInputSchema, await readJson(request)), requestMeta(request));
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return errorResponse(err, { route: "alert_rules.create" });
  }
}
