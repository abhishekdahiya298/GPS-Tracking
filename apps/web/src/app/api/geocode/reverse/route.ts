import { NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/authz";
import { errorResponse, ValidationError } from "@/lib/errors";
import { assertRateLimit } from "@/lib/rate-limit";
import { reverseGeocode } from "@/lib/reverse-geocode";

export const dynamic = "force-dynamic";

/** Street address for a position: ?lat=&lon=. Any signed-in member (app and website); 240 a minute each. */
export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    await assertRateLimit("revgeo", ctx.userId, 240, 60, "Too many address lookups. Wait a minute and try again.");
    const p = new URL(request.url).searchParams;
    const lat = Number(p.get("lat"));
    const lon = Number(p.get("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new ValidationError("lat and lon are required");
    const result = await reverseGeocode(lat, lon);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, max-age=3600" } });
  } catch (err) {
    return errorResponse(err, { route: "geocode.reverse" });
  }
}
