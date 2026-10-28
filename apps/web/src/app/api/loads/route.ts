import { NextResponse } from "next/server";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { createLoad, listLoads, LOAD_LIST_FILTERS, LoadInputSchema } from "@/lib/loads";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

/** The organization's loads. ?filter=active (default) | ended | all, optional ?q= search. */
export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "loads.read");
    const sp = new URL(request.url).searchParams;
    const f = sp.get("filter");
    const filter = (LOAD_LIST_FILTERS as readonly string[]).includes(f ?? "") ? (f as (typeof LOAD_LIST_FILTERS)[number]) : "active";
    return NextResponse.json({ loads: await listLoads(ctx.organizationId, { filter, q: sp.get("q") ?? undefined }) }, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err, { route: "loads.list" });
  }
}

/** Creates a load and its driver link (returned once); texts the driver when asked and SMS is set up. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "loads.write");
    const created = await createLoad(ctx, parseOrThrow(LoadInputSchema, await readJson(request)), requestMeta(request));
    return NextResponse.json(created, { status: 201, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err, { route: "loads.create" });
  }
}
