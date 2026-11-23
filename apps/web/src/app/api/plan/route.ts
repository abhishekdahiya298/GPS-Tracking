import { NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/authz";
import { planAccessFor } from "@/lib/entitlements";
import { errorResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** GET /api/plan: the caller's company plan, locks, limits and usage (any member; the app uses it too). */
export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    return NextResponse.json({ plan: await planAccessFor(ctx.organizationId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "plan.get" });
  }
}
