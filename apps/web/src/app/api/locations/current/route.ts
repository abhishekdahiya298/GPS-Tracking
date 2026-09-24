import { NextResponse } from "next/server";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { getServerEnv } from "@/lib/env";
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
    const devices = await listCurrentLocations(ctx.organizationId, now, env.GPS_DEVICE_OFFLINE_THRESHOLD_SECONDS);
    return NextResponse.json(
      { generatedAt: now.toISOString(), offlineThresholdSeconds: env.GPS_DEVICE_OFFLINE_THRESHOLD_SECONDS, devices },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return errorResponse(err, { route: "locations.current" });
  }
}
