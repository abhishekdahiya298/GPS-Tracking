import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { sendTestToSelf } from "@/lib/report-schedules";
import { requestMeta } from "@/lib/request-meta";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** Emails the latest completed period of this schedule to the caller only. */
export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "reports.manage");
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Report schedule not found");
    return NextResponse.json(await sendTestToSelf(ctx, id, requestMeta(request)));
  } catch (err) {
    return errorResponse(err, { route: "report_schedules.test" });
  }
}
