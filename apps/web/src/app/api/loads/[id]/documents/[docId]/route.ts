import { NextResponse } from "next/server";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { documentFile, loadPaperwork, removeLoadDocument } from "@/lib/paperwork";
import { requestMeta } from "@/lib/request-meta";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; docId: string }> };

/** GET: the file itself (only for the load's company). ?download=1 saves it instead of showing it. */
export async function GET(request: Request, { params }: Params) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "loads.read");
    const { id, docId } = await params;
    const f = await documentFile(ctx.organizationId, id, docId);
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new NextResponse(new Uint8Array(f.data), {
      headers: {
        "Content-Type": f.contentType,
        "Content-Length": String(f.data.length),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${f.fileName.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"
      }
    });
  } catch (err) {
    return errorResponse(err, { route: "loads.document_get" });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "loads.write");
    const { id, docId } = await params;
    await removeLoadDocument(ctx, id, docId, requestMeta(request));
    return NextResponse.json(await loadPaperwork(ctx.organizationId, id));
  } catch (err) {
    return errorResponse(err, { route: "loads.document_delete" });
  }
}
