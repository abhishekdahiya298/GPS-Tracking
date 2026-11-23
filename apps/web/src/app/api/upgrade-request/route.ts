import { NextResponse } from "next/server";
import { requireAuthenticatedUser, resolveTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { createUpgradeRequest, UpgradeRequestSchema } from "@/lib/leads";
import { organizationPlanAccess } from "@/lib/plans";
import { readJson } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

/** POST /api/upgrade-request: a customer asks RIO to switch on more (becomes a lead in the console). */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireAuthenticatedUser(request);
    const ctx = await resolveTenantContext(user);
    const body = parseOrThrow(UpgradeRequestSchema, await readJson(request));
    const access = await organizationPlanAccess(ctx.organizationId);
    const lead = await createUpgradeRequest({ userId: user.userId, name: user.name, email: user.email, organizationId: ctx.organizationId }, body, access?.planName ?? null);
    return NextResponse.json(lead, { status: 201 });
  } catch (err) {
    return errorResponse(err, { route: "upgrade_request.create" });
  }
}
