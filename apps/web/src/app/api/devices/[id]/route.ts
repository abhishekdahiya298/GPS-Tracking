import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { readJson, requestMeta } from "@/lib/request-meta";
import { DevicePatchSchema, parseOrThrow, updateDevice } from "@/lib/vehicles";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** PATCH { name?: string | null, active?: boolean } — Org Admin only (devices.manage). */
export async function PATCH(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "devices.manage");
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Device not found");
    await updateDevice(ctx, id, parseOrThrow(DevicePatchSchema, await readJson(request)), requestMeta(request));
    return NextResponse.json({ status: "updated" });
  } catch (err) {
    return errorResponse(err, { route: "devices.update" });
  }
}
