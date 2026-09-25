import { NextResponse } from "next/server";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { createItem, ItemInputSchema, listItems } from "@/lib/maintenance";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "maintenance.read");
    return NextResponse.json({ items: await listItems(ctx.organizationId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "maintenance.list" });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "maintenance.write");
    const id = await createItem(ctx, parseOrThrow(ItemInputSchema, await readJson(request)), requestMeta(request));
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return errorResponse(err, { route: "maintenance.create" });
  }
}
