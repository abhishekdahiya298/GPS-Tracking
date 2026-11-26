import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/admin-guard";
import { getServerEnv } from "@/lib/env";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { getCommandReplies, getTrackerDiagnostics } from "@/lib/tracker-diagnostics";

export const dynamic = "force-dynamic";

const Query = z.object({
  hours: z.coerce.number().int().min(1).max(72).default(24),
  /** With `since`, only command replies received after it (the page polls this after a send). */
  since: z.string().datetime().optional()
});

/** Super admin only. Read-only: Traccar's stored reports for one tracker, on demand. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireSuperAdmin(request);
    const { id } = await ctx.params;
    if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Tracker not found");
    const url = new URL(request.url);
    const q = Query.safeParse(Object.fromEntries(url.searchParams));
    if (!q.success) return NextResponse.json({ error: "Invalid query" }, { status: 400 });
    const body = q.data.since
      ? { replies: await getCommandReplies(id, new Date(q.data.since)) }
      : await getTrackerDiagnostics(id, q.data.hours, getServerEnv().GPS_DEVICE_OFFLINE_THRESHOLD_SECONDS);
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "admin.trackers.diagnostics" });
  }
}
