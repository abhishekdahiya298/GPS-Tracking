import { NextResponse } from "next/server";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { getServerEnv, offlineThresholdSeconds } from "@/lib/env";
import { errorResponse } from "@/lib/errors";
import { listCurrentLocations } from "@/lib/locations";

export const dynamic = "force-dynamic";

/** Latest known location + online/offline for every device in the caller's organization. */
export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "locations.read");
    const env = getServerEnv();
    const now = new Date();
    const devices = await listCurrentLocations(ctx.organizationId, now, offlineThresholdSeconds(env));
    return NextResponse.json(
      { generatedAt: now.toISOString(), offlineThresholdSeconds: offlineThresholdSeconds(env), devices },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return errorResponse(err, { route: "locations.current" });
  }
}
