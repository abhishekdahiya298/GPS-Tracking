import { NextResponse } from "next/server";
import { z } from "zod";
import { countUnacknowledged, listEvents } from "@/lib/alerts";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { errorResponse, ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const Query = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  unacknowledged: z.enum(["0", "1"]).default("0"),
  beforeId: z.coerce.number().int().positive().optional()
});

/** GET /api/alerts?limit=&unacknowledged=1&beforeId= — newest first. */
export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "alerts.read");
    const q = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!q.success) throw new ValidationError(q.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const events = await listEvents(ctx.organizationId, { limit: q.data.limit, unacknowledgedOnly: q.data.unacknowledged === "1", beforeId: q.data.beforeId });
    return NextResponse.json({ events, unacknowledged: await countUnacknowledged(ctx.organizationId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "alerts.list" });
  }
}
