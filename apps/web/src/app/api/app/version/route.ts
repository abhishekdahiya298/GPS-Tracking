import { NextResponse } from "next/server";
import { AppCheckQuery, checkAppVersion } from "@/lib/app-releases";
import { errorResponse, ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/app/version?platform=android&version=1.2.0 — public. Tells the app whether it is
 * up to date, may update ("optional") or must update ("required"), and where to update.
 */
export async function GET(request: Request) {
  try {
    const q = AppCheckQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!q.success) throw new ValidationError("platform (android or ios) and version (like 1.2.0) are required");
    return NextResponse.json(await checkAppVersion(q.data.platform, q.data.version), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "app.version" });
  }
}
