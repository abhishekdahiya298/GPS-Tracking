import { NextResponse } from "next/server";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { LoadPaperworkSchema, loadPaperwork, setLoadPaperwork } from "@/lib/paperwork";
import { readJson } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** GET: the load's paperwork (items, files, what's missing, packet). */
export async function GET(request: Request, { params }: Params) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "loads.read");
    return NextResponse.json(await loadPaperwork(ctx.organizationId, (await params).id), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "loads.paperwork" });
  }
}

/** PUT {items:[{key, mode}]}: this load's own Off/Optional/Required ([] = the company's list). */
export async function PUT(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "loads.write");
    return NextResponse.json(await setLoadPaperwork(ctx, (await params).id, parseOrThrow(LoadPaperworkSchema, await readJson(request))));
  } catch (err) {
    return errorResponse(err, { route: "loads.paperwork_set" });
  }
}
