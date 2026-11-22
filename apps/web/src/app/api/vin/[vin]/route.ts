import { NextResponse } from "next/server";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { errorResponse, ValidationError } from "@/lib/errors";
import { assertRateLimit } from "@/lib/rate-limit";
import { decodeVin } from "@/lib/vin-decode";

export const dynamic = "force-dynamic";

/** Year, make, model and fuel for a VIN (fills the Add/Edit vehicle form). 30 a minute each. */
export async function GET(request: Request, { params }: { params: Promise<{ vin: string }> }) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "vehicles.read");
    await assertRateLimit("vin", ctx.userId, 30, 60, "Too many VIN look-ups. Wait a minute and try again.");
    const info = await decodeVin((await params).vin);
    if (!info) throw new ValidationError("A VIN has 17 letters and numbers (no I, O or Q)");
    return NextResponse.json(info, { headers: { "Cache-Control": "private, max-age=86400" } });
  } catch (err) {
    return errorResponse(err, { route: "vin.decode" });
  }
}
