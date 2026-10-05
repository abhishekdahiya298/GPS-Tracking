import { canonicalTimeZone } from "@rio-gps/core/timezones";
import { getDb, schema } from "@rio-gps/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ActivityQuery, activityReportCsv, buildActivityReport } from "@/lib/activity-reports";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { getServerEnv } from "@/lib/env";
import { errorResponse, ValidationError } from "@/lib/errors";
import { getTimePrefs } from "@/lib/organization";

export const dynamic = "force-dynamic";
const DAY = 86_400_000;

/**
 * GET /api/reports/activity?type=stops|idling|speeding|mileage&deviceId=<uuid>|all&from=&to=
 *   &tz=&minMinutes=&limitKph=&format=json|csv   (history.read)
 * The organization always comes from the session. A device from another organization is a 404.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "history.read");
    const q = ActivityQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!q.success) throw new ValidationError(q.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const from = new Date(q.data.from);
    const to = new Date(q.data.to);
    if (from >= to) throw new ValidationError("from must be earlier than to");
    const maxDays = getServerEnv().MAX_HISTORY_RANGE_DAYS;
    // +1 h: a 31-day range that includes the autumn clock change is 31 days and 1 hour long.
    if (to.getTime() - from.getTime() > maxDays * DAY + 3_600_000) throw new ValidationError(`Range exceeds ${maxDays} days`);
    const tz = q.data.tz !== undefined ? canonicalTimeZone(q.data.tz) : (await getTimePrefs(ctx.organizationId, ctx.userId)).timeZone;
    if (!tz) throw new ValidationError("Unknown time zone");

    const report = await buildActivityReport(ctx.organizationId, q.data, tz);
    if (q.data.format === "csv") {
      const [org] = await getDb().select({ unitSystem: schema.organizations.unitSystem }).from(schema.organizations).where(eq(schema.organizations.id, ctx.organizationId));
      const file = `${q.data.type}-${q.data.from.slice(0, 10)}-to-${q.data.to.slice(0, 10)}.csv`;
      return new NextResponse(activityReportCsv(report, org?.unitSystem ?? "imperial"), {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file}"`, "Cache-Control": "no-store" }
      });
    }
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "reports.activity" });
  }
}
