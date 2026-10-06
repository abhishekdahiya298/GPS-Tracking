import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { requestMeta } from "@/lib/request-meta";
import { revokeShareLink } from "@/lib/share-links";

export const dynamic = "force-dynamic";

/** Revoke a link (effective immediately). A link of another organization is a 404. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "vehicles.update");
    requirePermission(ctx, "locations.read");
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Share link not found");
    await revokeShareLink(ctx, id, requestMeta(request));
    return NextResponse.json({ status: "revoked" });
  } catch (err) {
    return errorResponse(err, { route: "share_links.revoke" });
  }
}
