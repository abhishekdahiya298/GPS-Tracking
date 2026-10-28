import { NextResponse } from "next/server";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { getLoad, LoadActionSchema, setLoadOutcome } from "@/lib/loads";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

/** { action: "delivered" | "cancel" }: ends the load by hand; tracking stops. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "loads.write");
    const { id } = await params;
    await setLoadOutcome(ctx, id, parseOrThrow(LoadActionSchema, await readJson(request)).action, requestMeta(request));
    return NextResponse.json(await getLoad(ctx.organizationId, id));
  } catch (err) {
    return errorResponse(err, { route: "loads.status" });
  }
}
