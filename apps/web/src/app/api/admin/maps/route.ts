import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-guard";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { MapsSettingsSchema, setMapsSettings } from "@/lib/maps-settings";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

/** PUT: address service and default map look for the whole platform (platform admins only). */
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireSuperAdmin(request);
    await setMapsSettings(user.userId, parseOrThrow(MapsSettingsSchema, await readJson(request)), requestMeta(request));
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err, { route: "admin.maps.put" });
  }
}
