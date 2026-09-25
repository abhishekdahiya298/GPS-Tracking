import { getDb, schema } from "@rio-gps/db";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { getServerEnv } from "@/lib/env";
import { errorResponse, NotFoundError, ValidationError } from "@/lib/errors";
import { deviceBelongsToOrg } from "@/lib/locations";
import { buildTripReport, isValidTimeZone, tripReportCsv } from "@/lib/reports";

export const dynamic = "force-dynamic";
const DAY = 86_400_000;
const Query = z.object({
  deviceId: z.string().uuid(),
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  tz: z.string().max(64).default("UTC"),
  format: z.enum(["json", "csv"]).default("json")
});

/** GET /api/reports/trips?deviceId=&from=&to=&tz=America/Toronto&format=json|csv (history.read) */
export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "history.read");
    const q = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!q.success) throw new ValidationError(q.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const from = new Date(q.data.from);
    const to = new Date(q.data.to);
    if (from >= to) throw new ValidationError("from must be earlier than to");
    const maxDays = getServerEnv().MAX_HISTORY_RANGE_DAYS;
    if (to.getTime() - from.getTime() > maxDays * DAY) throw new ValidationError(`Range exceeds ${maxDays} days`);
    if (!isValidTimeZone(q.data.tz)) throw new ValidationError("Unknown time zone");
    if (!(await deviceBelongsToOrg(q.data.deviceId, ctx.organizationId))) throw new NotFoundError("Device not found");

    const report = await buildTripReport(ctx.organizationId, q.data.deviceId, from, to, q.data.tz);
    if (q.data.format === "csv") {
      const [label] = await getDb()
        .select({ vehicle: schema.vehicles.name, name: schema.gpsDevices.name, model: schema.gpsDevices.model })
        .from(schema.gpsDevices)
        .leftJoin(schema.deviceAssignments, and(eq(schema.deviceAssignments.deviceId, schema.gpsDevices.id), isNull(schema.deviceAssignments.unassignedAt)))
        .leftJoin(schema.vehicles, eq(schema.vehicles.id, schema.deviceAssignments.vehicleId))
        .where(and(eq(schema.gpsDevices.id, q.data.deviceId), eq(schema.gpsDevices.organizationId, ctx.organizationId)));
      const name = label?.vehicle ?? label?.name ?? label?.model ?? "device";
      const file = `trips-${name.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 40)}-${q.data.from.slice(0, 10)}-to-${q.data.to.slice(0, 10)}.csv`;
      return new NextResponse(tripReportCsv(report, name), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${file}"`,
          "Cache-Control": "no-store"
        }
      });
    }
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "reports.trips" });
  }
}
