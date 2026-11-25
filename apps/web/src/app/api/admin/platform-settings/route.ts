import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-guard";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { PlatformSettingsSchema, setPlatformSettings } from "@/lib/platform-settings";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

/** PUT: platform-wide settings (support contacts, driver app thresholds, new-company defaults). */
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireSuperAdmin(request);
    await setPlatformSettings(user.userId, parseOrThrow(PlatformSettingsSchema, await readJson(request)), requestMeta(request));
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err, { route: "admin.platform_settings.put" });
  }
}
