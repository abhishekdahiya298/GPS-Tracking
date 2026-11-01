import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-guard";
import { errorResponse, ValidationError } from "@/lib/errors";
import { PeriodSchema, statementCsv, usageStatement } from "@/lib/plans";

export const dynamic = "force-dynamic";

/** Monthly usage statement as CSV (`?month=2026-11`), for preparing invoices. */
export async function GET(request: Request) {
  try {
    await requireSuperAdmin(request);
    const month = PeriodSchema.safeParse(new URL(request.url).searchParams.get("month"));
    if (!month.success) throw new ValidationError("Month must look like 2026-11");
    const csv = statementCsv(await usageStatement(month.data));
    return new NextResponse(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="rio-gps-usage-${month.data}.csv"`, "Cache-Control": "no-store" }
    });
  } catch (err) {
    return errorResponse(err, { route: "admin.billing.csv" });
  }
}
