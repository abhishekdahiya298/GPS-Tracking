import { NextResponse } from "next/server";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { DEFAULT_PAPERWORK, getPaperworkSettings, PaperworkSettingsSchema, savePaperworkSettings } from "@/lib/paperwork";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

/** GET: the company's load paperwork settings (and the RIO GPS defaults). */
export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "loads.read");
    return NextResponse.json({ settings: await getPaperworkSettings(ctx.organizationId), defaults: DEFAULT_PAPERWORK }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "paperwork.settings_get" });
  }
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "organization.manage");
    const saved = await savePaperworkSettings(ctx, parseOrThrow(PaperworkSettingsSchema, await readJson(request)), requestMeta(request));
    return NextResponse.json({ settings: saved });
  } catch (err) {
    return errorResponse(err, { route: "paperwork.settings_put" });
  }
}
