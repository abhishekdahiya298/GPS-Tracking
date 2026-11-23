import { contextHasPermission } from "@rio-gps/core";
import { BookOpen, CalendarDays, CheckCircle2, Crown, History, Info, Layers, Radio, ReceiptText, Tag, Truck } from "lucide-react";
import { IconTitle } from "@/components/app/icon-title";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { countingRules, MODULE_LABEL, money, monthLabel, previousPeriod, termsSummary } from "@/lib/plan-format";
import { customerPlanHistory, listPlans, periodOf, usageStatement } from "@/lib/plans";
import { planAccessFor } from "@/lib/entitlements";
import { RequestUpgradeButton } from "@/components/app/plan/plan-ui";
import { PlanFeaturesSection, type OfferedPlan } from "./plan-features-section";
import { requireTenantPage } from "@/lib/request-context";

export const dynamic = "force-dynamic";
export const metadata = { title: "Plan & billing · RIO GPS" };

export default async function PlanPage() {
  const rc = await requireTenantPage("/settings/plan");
  if (!contextHasPermission(rc.ctx, "billing.read")) redirect("/dashboard");
  const orgId = rc.ctx.organizationId;
  const now = new Date();
  const period = periodOf(now, rc.timeZone);
  const periods = [period, previousPeriod(period, 1), previousPeriod(period, 2), previousPeriod(period, 3)];
  const [history, access, catalog, ...months] = await Promise.all([customerPlanHistory(orgId), planAccessFor(orgId), listPlans(), ...periods.map((p) => usageStatement(p, orgId, now).then((r) => r[0]!))]);
  const plan = history.find((h) => !h.endedAt) ?? null;
  const cur = months[0]!;
  const past = months.slice(1).filter((m) => m.loadsUsed > 0 || m.trackers > 0 || m.plan);

  const [py, pm] = period.split("-").map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const mon = new Date(Date.UTC(py, pm - 1, 15)).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const nextMon = new Date(Date.UTC(py, pm, 15)).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const nextYear = pm === 12 ? py + 1 : py;
  const gps = cur.plan?.modules.includes("gps") ?? false;
  const loads = cur.plan?.modules.includes("loads") ?? false;
  const loadPct = loads && cur.plan!.includedLoads > 0 ? Math.min(100, Math.round((cur.loadsUsed / cur.plan!.includedLoads) * 100)) : 0;
  const terms = plan
    ? [
        plan.monthlyFeeCents > 0 ? { icon: Truck, value: `${money(plan.monthlyFeeCents)}`, unit: "/ month", hint: "Base plan" } : null,
        plan.modules.includes("gps") ? { icon: Radio, value: money(plan.perTrackerCents), unit: "/ tracker / month", hint: `${cur.trackers} tracker${cur.trackers === 1 ? "" : "s"} now` } : null,
        plan.modules.includes("loads") && plan.includedLoads > 0 ? { icon: Layers, value: plan.includedLoads.toLocaleString("en-US"), unit: "loads / month", hint: "Included in plan" } : null,
        plan.modules.includes("loads") ? { icon: Tag, value: money(plan.extraLoadCents), unit: plan.includedLoads > 0 ? "/ extra load" : "/ load", hint: plan.includedLoads > 0 ? "After plan limit" : "Per tracked load" } : null
      ].filter((x): x is NonNullable<typeof x> => x !== null)
    : [];

  const limited = !!access && (access.lockedFeatures.length > 0 || Object.keys(access.limits).length > 0);
  // A free plan with limits: the page above says it all (no prices, no bill).
  const freeOnly = limited && !!plan && plan.monthlyFeeCents === 0 && plan.perTrackerCents === 0 && plan.extraLoadCents === 0;
  const trialDaysLeft = access?.trialEndsAt ? Math.max(0, Math.ceil((Date.parse(access.trialEndsAt) - now.getTime()) / 86_400_000)) : null;
  const offered: OfferedPlan[] = catalog
    .filter((p) => p.active && (p.visibility !== "hidden" || p.id === plan?.planId))
    .map((p) => ({
      id: p.id,
      name: p.name,
      priceText: p.priceNote || (p.monthlyFeeCents === 0 && p.perTrackerCents === 0 && p.extraLoadCents === 0 ? "$0" : [p.monthlyFeeCents > 0 ? `${money(p.monthlyFeeCents)}/mo` : null, p.perTrackerCents > 0 ? `${money(p.perTrackerCents)}/tracker` : null].filter(Boolean).join(" + ") || "Ask us"),
      lockedFeatures: p.lockedFeatures,
      limits: p.limits,
      includedLoads: p.includedLoads,
      current: p.id === plan?.planId
    }));

  return (
    <>
      <PageHeader
        title="Plan & billing"
        description={limited && plan ? `${plan.planName} · since ${new Date(plan.startedAt).toLocaleDateString("en-US", { timeZone: rc.timeZone, dateStyle: "medium" })}${cur.amounts.totalCents === 0 ? " · nothing is charged" : ""}` : "Your subscription, this month's usage and estimated bill."}
        actions={
          limited ? (
            <RequestUpgradeButton className="bg-white text-[#0a2463] hover:bg-white/90">Request upgrade</RequestUpgradeButton>
          ) : (
          <span className="inline-flex items-center gap-2 rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 text-white">
            <CalendarDays className="size-5" aria-hidden="true" />
            <span className="leading-tight">
              <span className="block text-[11px] text-white/75">Billing period</span>
              <span className="block text-sm font-semibold">
                {mon} 1 – {mon} {lastDay}, {py}
              </span>
            </span>
          </span>
          )
        }
      />
      {limited && access && <PlanFeaturesSection access={access} plans={offered} trialDaysLeft={trialDaysLeft} />}
      {limited && <div className="h-4" />}
      {!freeOnly && (
      <>
      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <Card className="relative overflow-hidden">
          <CardContent className="grid gap-4 p-5">
            {plan ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold text-primary">
                    <Crown className="size-3.5" aria-hidden="true" /> Your plan
                  </span>
                  <StatusBadge tone="success" label="Active" />
                </div>
                <div className="flex items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-2xl font-bold tracking-tight text-[#0a2463] dark:text-foreground">{plan.planName}</p>
                    <p className="m-0 mt-0.5 text-sm text-muted-foreground">
                      Since {new Date(plan.startedAt).toLocaleDateString("en-US", { timeZone: rc.timeZone, dateStyle: "medium" })} · Renews {nextMon} 1, {nextYear}
                    </p>
                    <ul className="m-0 mt-3 grid list-none gap-1.5 p-0 text-sm">
                      {plan.modules.map((m) => (
                        <li key={m} className="flex items-center gap-2 font-medium">
                          <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
                          {MODULE_LABEL[m]}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element -- static product art */}
                  <img src="/fleet-art/vehicles/3d-truck-moving.png" alt="" className="hidden h-24 w-auto shrink-0 drop-shadow-xl sm:block" />
                </div>
                {terms.length > 0 ? (
                  <div className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-muted/40 p-2 sm:grid-cols-2">
                    {terms.map((t) => (
                      <div key={t.unit} className="flex items-center gap-2 rounded-lg bg-background p-2.5">
                        <t.icon className="size-5 shrink-0 text-primary" aria-hidden="true" />
                        <span className="min-w-0 leading-tight">
                          <span className="block text-sm font-bold tabular-nums">
                            {t.value} <span className="text-[11px] font-medium text-muted-foreground">{t.unit}</span>
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">{t.hint}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="m-0 rounded-lg border border-border bg-muted/40 p-3 text-sm">{termsSummary(plan)[0]}</p>
                )}
                <p className="m-0 flex items-start gap-2 text-xs text-muted-foreground">
                  <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  To change your plan or the number of included loads, contact RIO GPS. Changes start the day they&apos;re made.
                </p>
              </>
            ) : (
              <div className="flex flex-col items-center px-4 py-8 text-center">
                <span className="grid size-12 place-items-center rounded-full bg-primary-soft text-primary">
                  <Crown className="size-6" aria-hidden="true" />
                </span>
                <p className="m-0 mt-3 text-base font-semibold text-[#0a2463] dark:text-foreground">No plan on record yet</p>
                <p className="m-0 mt-1 max-w-sm text-sm text-muted-foreground">Your plan and prices appear here once RIO GPS sets them up for your company.</p>
                <a href="mailto:support@riogps.com" className="mt-3 text-sm font-medium text-primary no-underline hover:underline">
                  Contact RIO GPS
                </a>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <IconTitle icon={CalendarDays}>{monthLabel(period)} usage</IconTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {gps && (
              <div className="flex items-center gap-3 rounded-xl border border-border p-3">
                <Radio className="size-5 text-[#15803d]" aria-hidden="true" />
                <span className="w-20 text-sm font-medium">Trackers</span>
                <span className="text-lg font-bold tabular-nums">{cur.trackers}</span>
                <span aria-hidden="true" className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-[#16a34a]" style={{ width: cur.trackers > 0 ? "100%" : "0%" }} />
                </span>
                <span className="w-16 text-right text-xs text-muted-foreground">billed</span>
              </div>
            )}
            {loads && (
              <div className="flex items-center gap-3 rounded-xl border border-border p-3">
                <Layers className="size-5 text-[#6d28d9]" aria-hidden="true" />
                <span className="w-20 text-sm font-medium">Loads</span>
                <span className="text-lg font-bold tabular-nums">
                  {cur.loadsUsed}
                  {cur.plan!.includedLoads > 0 && <span className="text-sm font-medium text-muted-foreground"> / {cur.plan!.includedLoads}</span>}
                </span>
                <span aria-hidden="true" className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <span className={`block h-full rounded-full ${loadPct >= 100 ? "bg-[#c2410c]" : "bg-[#6d28d9]"}`} style={{ width: `${loadPct}%` }} />
                </span>
                <span className="w-16 text-right text-xs text-muted-foreground">{cur.plan!.includedLoads > 0 ? `${loadPct}%` : "used"}</span>
              </div>
            )}
            <div className="grid gap-1.5 rounded-xl border border-border p-4 text-sm">
              <div className="mb-1 flex items-center justify-between">
                <span className="inline-flex items-center gap-2 font-semibold">
                  <ReceiptText className="size-4 text-primary" aria-hidden="true" /> Estimated for {monthLabel(period).split(" ")[0]}
                </span>
                <span className="text-lg font-bold tabular-nums">{money(cur.amounts.totalCents)}</span>
              </div>
              {gps && <Row label={`Trackers (${cur.trackers} × ${money(cur.plan!.perTrackerCents)})`} value={money(cur.amounts.trackersCents)} />}
              {cur.amounts.monthlyFeeCents > 0 && <Row label="Monthly fee" value={money(cur.amounts.monthlyFeeCents)} />}
              {loads && cur.extraLoads > 0 && <Row label={`Extra loads (${cur.extraLoads} × ${money(cur.plan!.extraLoadCents)})`} value={money(cur.amounts.extraLoadsCents)} />}
              <div className="mt-1 flex items-baseline justify-between rounded-lg bg-primary-soft px-3 py-2 font-semibold text-primary">
                <span>Total (est.)</span>
                <span className="text-base tabular-nums">{money(cur.amounts.totalCents)}</span>
              </div>
              <p className="m-0 text-xs text-muted-foreground">Before taxes. Your invoice for {monthLabel(period)} is made after the month ends.</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <Card>
          <CardHeader>
            <IconTitle icon={BookOpen}>How usage is counted</IconTitle>
          </CardHeader>
          <CardContent>
            <ul className="m-0 grid list-none gap-2.5 p-0 text-sm">
              {countingRules(plan?.modules ?? []).map((r) => (
                <li key={r} className="flex items-start gap-2.5">
                  <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-[#16a34a]" />
                  {r}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader>
            <IconTitle icon={History}>Earlier months</IconTitle>
          </CardHeader>
          {past.length === 0 ? (
            <CardContent>
              <p className="m-0 text-sm text-muted-foreground">Nothing yet.</p>
            </CardContent>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#dbe6f7] text-left text-xs font-semibold uppercase tracking-wide text-[#12357f] dark:bg-muted dark:text-foreground">
                  <th className="px-5 py-2.5">Month</th>
                  {loads && <th className="px-3 py-2.5 text-right">Loads</th>}
                  {gps && <th className="px-3 py-2.5 text-right">Trackers</th>}
                  <th className="px-5 py-2.5 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {past.map((m) => (
                  <tr key={m.period} className="border-t border-border">
                    <td className="px-5 py-2.5 font-medium">{monthLabel(m.period)}</td>
                    {loads && (
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {m.loadsUsed}
                        {m.extraLoads > 0 && <StatusBadge tone="warning" label={`+${m.extraLoads} extra`} className="ml-2" />}
                      </td>
                    )}
                    {gps && <td className="px-3 py-2.5 text-right tabular-nums">{m.trackers}</td>}
                    <td className="px-5 py-2.5 text-right font-semibold tabular-nums">{money(m.amounts.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
      </>
      )}
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
