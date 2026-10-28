import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { reissueDriverLink } from "@/lib/loads";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

/** A new driver link (the old one stops working), returned once; { send: true } also texts it. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "loads.write");
    const body = parseOrThrow(z.object({ send: z.boolean().default(false) }), (await readJson(request)) ?? {});
    return NextResponse.json(await reissueDriverLink(ctx, (await params).id, body, requestMeta(request)), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "loads.driver_link" });
  }
}
