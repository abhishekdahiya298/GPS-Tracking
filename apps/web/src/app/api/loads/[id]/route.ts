import { NextResponse } from "next/server";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { deleteLoad, getLoad, LoadPatchSchema, updateLoad } from "@/lib/loads";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** One load with its timeline and trail. A load of another organization is a 404. */
export async function GET(request: Request, { params }: Params) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "loads.read");
    return NextResponse.json(await getLoad(ctx.organizationId, (await params).id), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "loads.get" });
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "loads.write");
    const { id } = await params;
    await updateLoad(ctx, id, parseOrThrow(LoadPatchSchema, await readJson(request)), requestMeta(request));
    return NextResponse.json(await getLoad(ctx.organizationId, id));
  } catch (err) {
    return errorResponse(err, { route: "loads.update" });
  }
}

/** Deletes the load, its positions and its timeline. */
export async function DELETE(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "loads.write");
    await deleteLoad(ctx, (await params).id, requestMeta(request));
    return NextResponse.json({ status: "deleted" });
  } catch (err) {
    return errorResponse(err, { route: "loads.delete" });
  }
}
