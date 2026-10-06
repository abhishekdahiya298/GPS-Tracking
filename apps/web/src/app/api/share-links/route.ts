import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { readJson, requestMeta } from "@/lib/request-meta";
import { createShareLink, listShareLinks, ShareInputSchema } from "@/lib/share-links";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

/**
 * Sharing a live position outside the organization needs both the right to manage vehicles
 * and the right to see locations (Org Admin, Fleet Manager).
 */
function requireSharePermission(ctx: Parameters<typeof requirePermission>[0]) {
  requirePermission(ctx, "vehicles.update");
  requirePermission(ctx, "locations.read");
}

/** The organization's share links (never the tokens). Optional ?vehicleId=. */
export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    requireSharePermission(ctx);
    const vehicleId = new URL(request.url).searchParams.get("vehicleId");
    const filter = vehicleId && z.string().uuid().safeParse(vehicleId).success ? { vehicleId } : {};
    return NextResponse.json({ links: await listShareLinks(ctx.organizationId, filter) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "share_links.list" });
  }
}

/** Creates a link and returns its token ONCE. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requireSharePermission(ctx);
    const link = await createShareLink(ctx, parseOrThrow(ShareInputSchema, await readJson(request)), requestMeta(request));
    return NextResponse.json(link, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "share_links.create" });
  }
}
