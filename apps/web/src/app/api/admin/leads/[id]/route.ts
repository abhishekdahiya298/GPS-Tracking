import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/admin-guard";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { setLeadStatus } from "@/lib/leads";
import { readJson } from "@/lib/request-meta";
import { LEAD_STATUSES } from "@/lib/schemas/lead";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

const Patch = z.object({ status: z.enum(LEAD_STATUSES) });

/** Platform admins only: mark a pricing request as new, contacted or closed. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    await requireSuperAdmin(request);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Request not found");
    await setLeadStatus(id, parseOrThrow(Patch, await readJson(request)).status);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "admin.leads.update" });
  }
}
