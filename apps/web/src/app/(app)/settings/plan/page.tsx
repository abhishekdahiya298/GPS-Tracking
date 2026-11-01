import { contextHasPermission } from "@rio-gps/core";
import { Check } from "lucide-react";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { UsageMeter } from "@/components/app/usage-meter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { countingRules, MODULE_LABEL, money, monthLabel, previousPeriod, termsSummary } from "@/lib/plan-format";
import { customerPlanHistory, periodOf, usageStatement } from "@/lib/plans";
import { requireTenantPage } from "@/lib/request-context";

export const dynamic = "force-dynamic";
export const metadata = { title: "Plan & usage · RIO GPS" };

export default async function PlanPage() {
  const rc = await requireTenantPage("/settings/plan");
  if (!contextHasPermission(rc.ctx, "billing.read")) redirect("/dashboard");
  const orgId = rc.ctx.organizationId;
  const now = new Date();
  const period = periodOf(now, rc.timeZone);
  const periods = [period, previousPeriod(period, 1), previousPeriod(period, 2), previousPeriod(period, 3)];
  const [history, ...months] = await Promise.all([customerPlanHistory(orgId), ...periods.map((p) => usageStatement(p, orgId, now).then((r) => r[0]!))]);
  const plan = history.find((h) => !h.endedAt) ?? null;
  const cur = months[0]!;
  const past = months.slice(1).filter((m) => m.loadsUsed > 0 || m.trackers > 0 || m.plan);

  return (
    <>
      <PageHeader title="Plan & usage" description="What your company's plan includes and what you've used this month." />
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader>
            <CardTitle>Your plan</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {plan ? (
              <>
                <div>
                  <p className="m-0 text-xl font-semibold">{plan.planName}</p>
                  <p className="m-0 mt-0.5 text-sm text-muted-foreground">
                    Since {new Date(plan.startedAt).toLocaleDateString("en-US", { timeZone: rc.timeZone, dateStyle: "medium" })}
                  </p>
                </div>
                <ul className="m-0 grid list-none gap-1.5 p-0 text-sm">
                  {plan.modules.map((m) => (
                    <li key={m} className="flex items-center gap-2">
                      <Check className="size-4 text-success" aria-hidden="true" />
                      {MODULE_LABEL[m]}
                    </li>
                  ))}
                </ul>
                <div className="grid gap-1 rounded-lg border border-border bg-muted/40 p-3 text-sm">
                  {termsSummary(plan).map((t) => (
                    <p key={t} className="m-0">
                      {t}
                    </p>
                  ))}
                </div>
                <p className="m-0 text-sm text-muted-foreground">To change your plan or the number of included loads, contact RIO GPS. Changes start the day they&apos;re made.</p>
              </>
            ) : (
              <p className="m-0 text-sm text-muted-foreground">No plan is recorded for your company yet. Contact RIO GPS.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{monthLabel(period)} so far</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            {cur.plan?.modules.includes("loads") && <UsageMeter label="Loads" used={cur.loadsUsed} included={cur.plan.includedLoads} />}
            {cur.plan?.modules.includes("gps") && (
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium">Trackers</span>
                <span className="font-semibold tabular-nums">{cur.trackers}</span>
              </div>
            )}
            <div className="grid gap-1.5 border-t border-border pt-4 text-sm">
              {cur.amounts.monthlyFeeCents > 0 && <Row label="Monthly fee" value={money(cur.amounts.monthlyFeeCents)} />}
              {cur.plan?.modules.includes("gps") && <Row label={`Trackers (${cur.trackers} × ${money(cur.plan.perTrackerCents)})`} value={money(cur.amounts.trackersCents)} />}
              {cur.plan?.modules.includes("loads") && cur.extraLoads > 0 && <Row label={`Extra loads (${cur.extraLoads} × ${money(cur.plan.extraLoadCents)})`} value={money(cur.amounts.extraLoadsCents)} />}
              <Row label="Estimated so far" value={money(cur.amounts.totalCents)} strong />
              <p className="m-0 text-xs text-muted-foreground">Before taxes. Your invoice for {monthLabel(period)} is made after the month ends.</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader>
            <CardTitle>How usage is counted</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="m-0 grid gap-2 pl-5 text-sm text-muted-foreground">
              {countingRules(plan?.modules ?? []).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Earlier months</CardTitle>
          </CardHeader>
          <CardContent>
            {past.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">Nothing yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 font-medium">Month</th>
                    <th className="pb-2 text-right font-medium">Loads</th>
                    <th className="pb-2 text-right font-medium">Trackers</th>
                    <th className="pb-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {past.map((m) => (
                    <tr key={m.period} className="border-t border-border">
                      <td className="py-2">{monthLabel(m.period)}</td>
                      <td className="py-2 text-right tabular-nums">
                        {m.loadsUsed}
                        {m.extraLoads > 0 && <StatusBadge tone="warning" label={`+${m.extraLoads} extra`} className="ml-2" />}
                      </td>
                      <td className="py-2 text-right tabular-nums">{m.trackers}</td>
                      <td className="py-2 text-right tabular-nums">{money(m.amounts.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${strong ? "border-t border-border pt-2 text-base font-semibold" : ""}`}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
