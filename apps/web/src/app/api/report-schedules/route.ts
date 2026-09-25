import { NextResponse } from "next/server";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { createSchedule, listSchedules, ScheduleInputSchema } from "@/lib/report-schedules";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "reports.manage");
    return NextResponse.json({ schedules: await listSchedules(ctx.organizationId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "report_schedules.list" });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "reports.manage");
    const id = await createSchedule(ctx, parseOrThrow(ScheduleInputSchema, await readJson(request)), requestMeta(request));
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return errorResponse(err, { route: "report_schedules.create" });
  }
}
