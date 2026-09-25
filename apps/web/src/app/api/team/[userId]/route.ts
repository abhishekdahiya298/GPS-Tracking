import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { readJson, requestMeta } from "@/lib/request-meta";
import { ChangeRoleSchema, changeRole, removeMember } from "@/lib/team";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ userId: string }> };

async function targetUserId(params: Params["params"]) {
  const { userId } = await params;
  if (!z.string().uuid().safeParse(userId).success) throw new NotFoundError("Member not found");
  return userId;
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "users.manage");
    const userId = await targetUserId(params);
    const { role } = parseOrThrow(ChangeRoleSchema, await readJson(request));
    await changeRole(ctx, userId, role, requestMeta(request));
    return NextResponse.json({ status: "updated" });
  } catch (err) {
    return errorResponse(err, { route: "team.role" });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "users.manage");
    await removeMember(ctx, await targetUserId(params), requestMeta(request));
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err, { route: "team.remove" });
  }
}
