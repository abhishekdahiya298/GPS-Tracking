import { NextResponse } from "next/server";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { readJson, requestMeta } from "@/lib/request-meta";
import { AddMemberSchema, addMember, listMembers } from "@/lib/team";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "users.read");
    return NextResponse.json({ members: await listMembers(ctx.organizationId), you: ctx.userId }, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err, { route: "team.list" });
  }
}

/** Adds a member. A brand-new account gets a one-time temporary password in the response (never stored in plain text or logged). */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "users.manage");
    const input = parseOrThrow(AddMemberSchema, await readJson(request));
    const result = await addMember(ctx, input, requestMeta(request));
    return NextResponse.json(result, { status: 201, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err, { route: "team.add" });
  }
}
