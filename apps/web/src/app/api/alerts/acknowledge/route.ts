import { NextResponse } from "next/server";
import { z } from "zod";
import { acknowledgeEvents } from "@/lib/alerts";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { readJson } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";
const Body = z.union([z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) }), z.object({ all: z.literal(true) })]);

/** POST { ids: [..] } or { all: true } — only this org's events are touched. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "alerts.write");
    const body = parseOrThrow(Body, await readJson(request));
    const n = await acknowledgeEvents(ctx, "all" in body ? "all" : body.ids);
    return NextResponse.json({ acknowledged: n });
  } catch (err) {
    return errorResponse(err, { route: "alerts.ack" });
  }
}
