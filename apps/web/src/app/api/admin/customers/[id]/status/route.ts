import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/admin-guard";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { setCustomerStatus, SetCustomerStatusSchema } from "@/lib/organization-status";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** POST { status: "active" | "suspended" | "archived", reason? } — suspend, archive (soft delete) or restore a customer. */
export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const user = await requireSuperAdmin(request);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Customer not found");
    const out = await setCustomerStatus(user.userId, id, parseOrThrow(SetCustomerStatusSchema, await readJson(request)), requestMeta(request));
    return NextResponse.json(out);
  } catch (err) {
    return errorResponse(err, { route: "admin.customers.status" });
  }
}
