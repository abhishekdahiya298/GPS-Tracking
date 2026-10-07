import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { requestMeta } from "@/lib/request-meta";
import { resetMemberTwoStep } from "@/lib/team";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ userId: string }> };

/** Turns a member's two-step verification off (lost phone) and signs them out everywhere. */
export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "users.manage");
    const { userId } = await params;
    if (!z.string().uuid().safeParse(userId).success) throw new NotFoundError("Member not found");
    await resetMemberTwoStep(ctx, userId, requestMeta(request));
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "team.reset_two_step" });
  }
}
