import { NextResponse } from "next/server";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { errorResponse } from "@/lib/errors";
import { geocode } from "@/lib/geocode";
import { assertRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Address search for load stops: ?q=. Signed-in users who can create loads; 30 per minute each. */
export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "loads.write");
    await assertRateLimit("geocode", ctx.userId, 30, 60, "Too many address searches. Wait a minute and try again.");
    const q = new URL(request.url).searchParams.get("q") ?? "";
    return NextResponse.json({ results: await geocode(q) }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (err) {
    return errorResponse(err, { route: "geocode" });
  }
}
