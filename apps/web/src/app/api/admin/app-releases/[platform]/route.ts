import { NextResponse } from "next/server";
import { APP_PLATFORMS, type AppPlatform } from "@rio-gps/core/app-version";
import { requireSuperAdmin } from "@/lib/admin-guard";
import { AppReleaseInputSchema, setAppRelease } from "@/lib/app-releases";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

/** PUT: the update policy for one platform (platform admins only). */
export async function PUT(request: Request, ctx: { params: Promise<{ platform: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireSuperAdmin(request);
    const { platform } = await ctx.params;
    if (!(APP_PLATFORMS as readonly string[]).includes(platform)) throw new NotFoundError("Unknown platform");
    await setAppRelease(user.userId, platform as AppPlatform, parseOrThrow(AppReleaseInputSchema, await readJson(request)), requestMeta(request));
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err, { route: "admin.app_releases.put" });
  }
}
