import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { getServerEnv } from "@/lib/env";
import { errorResponse, NotFoundError, ValidationError } from "@/lib/errors";
import { decodeCursor, deviceBelongsToOrg, queryHistory } from "@/lib/locations";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;
const QuerySchema = z.object({
  deviceId: z.string().uuid(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(2000),
  cursor: z.string().max(200).optional()
});

/**
 * GET /api/locations/history?deviceId=<uuid>&from=<ISO>&to=<ISO>&limit=&cursor=
 * Time-ordered track for one device of the caller's organization.
 * Defaults to the last 24 h; the window is capped at MAX_HISTORY_RANGE_DAYS.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "history.read");

    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = QuerySchema.safeParse(params);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join(".") || "query"}: ${i.message}`).join("; "));
    }
    const q = parsed.data;
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - DAY_MS);
    const maxDays = getServerEnv().MAX_HISTORY_RANGE_DAYS;
    if (from >= to) throw new ValidationError("from must be earlier than to");
    if (to.getTime() - from.getTime() > maxDays * DAY_MS) {
      throw new ValidationError(`Range exceeds ${maxDays} days`);
    }
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    if (q.cursor && !cursor) throw new ValidationError("Invalid cursor");

    // Same 404 for "doesn't exist" and "belongs to another org": no cross-tenant existence oracle.
    if (!(await deviceBelongsToOrg(q.deviceId, ctx.organizationId))) throw new NotFoundError("Device not found");

    const result = await queryHistory({ organizationId: ctx.organizationId, deviceId: q.deviceId, from, to, limit: q.limit, cursor });
    return NextResponse.json(
      { deviceId: q.deviceId, from: from.toISOString(), to: to.toISOString(), count: result.points.length, ...result },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return errorResponse(err, { route: "locations.history" });
  }
}
