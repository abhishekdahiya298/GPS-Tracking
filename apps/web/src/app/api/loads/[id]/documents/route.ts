import { NextResponse } from "next/server";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse, ValidationError } from "@/lib/errors";
import { addLoadDocument, loadPaperwork } from "@/lib/paperwork";
import { readUpload } from "@/lib/upload";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** POST multipart {file, itemKey}: the team uploads paperwork for a load (e.g. a POD the receiver emailed). */
export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "loads.write");
    const { id } = await params;
    const up = await readUpload(request);
    if (!up.itemKey) throw new ValidationError("Choose what this file is");
    await addLoadDocument({ organizationId: ctx.organizationId, loadId: id, itemKey: up.itemKey, data: up.data, fileName: up.fileName, method: "upload", userId: ctx.userId });
    return NextResponse.json(await loadPaperwork(ctx.organizationId, id), { status: 201 });
  } catch (err) {
    return errorResponse(err, { route: "loads.document_upload" });
  }
}
