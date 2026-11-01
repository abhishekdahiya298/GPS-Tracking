import { redirect } from "next/navigation";
import { previousPeriod } from "@/lib/plan-format";
import { periodOf, PeriodSchema, usageStatement } from "@/lib/plans";
import { getRequestContext } from "@/lib/request-context";
import { BillingView } from "./billing-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Usage & billing · RIO GPS" };

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const rc = await getRequestContext();
  if (rc.status === "unauthenticated") redirect("/login?next=/admin/billing");
  if (!rc.user.isSuperAdmin) redirect("/dashboard");
  const current = periodOf(new Date(), "UTC");
  const asked = PeriodSchema.safeParse((await searchParams).month);
  const month = asked.success && asked.data <= current ? asked.data : current;
  const months = Array.from({ length: 12 }, (_, i) => previousPeriod(current, i));
  const all = (await usageStatement(month)).filter((l) => l.plan || l.loadsUsed > 0 || l.trackers > 0);
  // Archived customers aren't billed; they're left out of the statement (and its CSV).
  const lines = all.filter((l) => l.billed);
  return <BillingView month={month} months={months} current={month === current} lines={lines} archived={all.length - lines.length} />;
}
