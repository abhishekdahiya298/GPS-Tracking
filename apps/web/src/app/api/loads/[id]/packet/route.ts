import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { buildLoadPacket, loadPaperwork, sendLoadPacket } from "@/lib/paperwork";
import { readJson } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** GET: the load packet PDF (details, timeline, every document). */
export async function GET(request: Request, { params }: Params) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "loads.read");
    const { pdf, filename } = await buildLoadPacket(ctx.organizationId, (await params).id);
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`, "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "loads.packet_get" });
  }
}

/** POST {to?: string[]}: email the packet now (to the company's list, plus any extra emails). */
export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "loads.write");
    const { id } = await params;
    const body = parseOrThrow(z.object({ to: z.array(z.string().trim().email()).max(5).default([]) }), (await readJson(request).catch(() => ({}))) ?? {});
    const r = await sendLoadPacket(ctx.organizationId, id, ctx.userId, "manual", body.to);
    return NextResponse.json({ ...r, paperwork: await loadPaperwork(ctx.organizationId, id) });
  } catch (err) {
    return errorResponse(err, { route: "loads.packet_send" });
  }
}
