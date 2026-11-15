import { NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/authz";
import { errorResponse } from "@/lib/errors";
import { getMapsSettings } from "@/lib/maps-settings";

export const dynamic = "force-dynamic";

/** What the phone app needs to know about maps: whether addresses are on, the default map look and the default map icons. */
export async function GET(request: Request) {
  try {
    await requireTenantContext(request);
    const s = await getMapsSettings();
    return NextResponse.json({ addresses: s.addressProvider !== "off", mapStyle: s.mapStyle, iconStyle: s.iconStyle, iconColor: s.iconColor, mobileMap: s.mobileMap }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (err) {
    return errorResponse(err, { route: "maps.config" });
  }
}
