import { NextResponse } from "next/server";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { lookupDriverPhone } from "@/lib/driver-loads";
import { errorResponse, ValidationError } from "@/lib/errors";
import { phoneProblem, normalizePhone } from "@/lib/phone";
import { assertRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** GET ?phone=: is this driver's number on the RIO GPS app (A43)? Rate-limited per person. */
export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "loads.write");
    const raw = new URL(request.url).searchParams.get("phone") ?? "";
    const phone = normalizePhone(raw);
    if (!phone) throw new ValidationError(phoneProblem(raw) ?? "Enter a mobile number");
    await assertRateLimit("driver_lookup", ctx.userId, 30, 60, "Too many lookups. Wait a minute and try again.");
    await assertRateLimit("driver_lookup_day", ctx.organizationId, 1000, 86_400, "Too many lookups today. Try again tomorrow.");
    return NextResponse.json(await lookupDriverPhone(ctx.organizationId, phone), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "drivers.lookup" });
  }
}
