import { NextResponse } from "next/server";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { errorResponse } from "@/lib/errors";
import { reverseGeocode } from "@/lib/geocode";
import { assertRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** The street address of a position: ?lat=&lon=. Anyone who can see vehicle positions; 60 per minute each. */
export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "locations.read");
    await assertRateLimit("geocode-reverse", ctx.userId, 60, 60, "Too many address lookups. Wait a minute and try again.");
    const params = new URL(request.url).searchParams;
    const address = await reverseGeocode(Number(params.get("lat")), Number(params.get("lon")));
    return NextResponse.json({ address }, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch (err) {
    return errorResponse(err, { route: "geocode.reverse" });
  }
}
