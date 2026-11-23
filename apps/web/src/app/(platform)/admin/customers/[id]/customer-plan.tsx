"use client";
import type { Module } from "@rio-gps/core";
import { FEATURE_LABEL, FEATURES, LIMIT_LABEL, LIMITS, type Feature, type LimitKey, type PlanLimits } from "@rio-gps/core/plan-features";
import { ArrowRightLeft, ChevronDown, History } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTime } from "@/components/app/time-context";
import { StatusBadge } from "@/components/app/status-badge";
import { UsageMeter } from "@/components/app/usage-meter";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import { MODULE_LABEL, money, monthLabel, termsSummary } from "@/lib/plan-format";
import type { PlanDto, SubscriptionDto, UsageLine } from "@/lib/plans";

export interface CustomerBilling {
  history: SubscriptionDto[];
  usage: UsageLine | null;
  plans: PlanDto[];
}

/** Plan, this month's usage and plan history on a customer's page (platform console). */
export function CustomerPlanCard({ customerId, customerName, billing, archived = false }: { customerId: string; customerName: string; billing: CustomerBilling; archived?: boolean }) {
  const time = useTime();
  const [changing, setChanging] = useState(false);
  const plan = billing.history.find((h) => !h.endedAt) ?? null;
  const earlier = billing.history.filter((h) => h.endedAt);
  const u = billing.usage;
  const free = plan ? termsSummary(plan)[0]?.startsWith("Free") : false;
  const prices = plan
    ? [
        { label: "Monthly fee", value: money(plan.monthlyFeeCents), show: true },
        { label: "Per tracker / month", value: money(plan.perTrackerCents), show: plan.modules.includes("gps") },
        { label: "Loads included / month", value: plan.includedLoads > 0 ? plan.includedLoads.toLocaleString("en-US") : "None", show: plan.modules.includes("loads") },
        { label: plan.includedLoads > 0 ? "Each extra load" : "Each load", value: money(plan.extraLoadCents), show: plan.modules.includes("loads") }
      ].filter((p) => p.show)
    : [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>Plan</CardTitle>
        <Button size="sm" variant="secondary" onClick={() => setChanging(true)}>
          <ArrowRightLeft /> Change plan
        </Button>
      </CardHeader>
      <div className="grid gap-4 px-4 pb-4 pt-4 text-sm">
        {plan ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="m-0 text-lg font-semibold leading-6 text-[#0a2463]">{plan.planName}</p>
                <p className="m-0 mt-0.5 text-xs text-muted-foreground">
                  Since {time.date(plan.startedAt)}
                  {plan.changedByName ? ` · set by ${plan.changedByName}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {plan.modules.map((m) => (
                  <StatusBadge key={m} tone={m === "gps" ? "info" : "success"} label={MODULE_LABEL[m]} />
                ))}
              </div>
            </div>
            {plan.trialEndsAt && (
              <Alert tone="info" title={`Trial until ${time.date(plan.trialEndsAt)}`}>
                Goes back to the plan before the trial by itself. Change plan to keep it.
              </Alert>
            )}
            {(plan.lockedFeatures.length > 0 || Object.keys(plan.limits).length > 0) && (
              <p className="m-0 text-xs text-muted-foreground">
                {Object.entries(plan.limits)
                  .map(([k, v]) => `${LIMIT_LABEL[k as LimitKey]}: ${v}`)
                  .join(" · ")}
                {plan.lockedFeatures.length > 0 ? `${Object.keys(plan.limits).length ? " · " : ""}${plan.lockedFeatures.length} features locked` : ""}
              </p>
            )}
            {plan.note && <p className="m-0 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">{plan.note}</p>}
            {free ? (
              <p className="m-0 rounded-lg border border-dashed border-border px-3 py-2.5 text-center text-sm font-medium text-muted-foreground">Free: nothing is charged</p>
            ) : (
              <dl className="m-0 grid grid-cols-2 gap-2">
                {prices.map((p) => (
                  <div key={p.label} className="rounded-lg border border-border px-3 py-2">
                    <dt className="text-xs text-muted-foreground">{p.label}</dt>
                    <dd className="m-0 mt-0.5 text-base font-semibold tabular-nums">{p.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </>
        ) : (
          <Alert tone="warning" title="No plan recorded">
            Until a plan is set, this customer has every module. Choose a plan.
          </Alert>
        )}

        {u && plan && (
          <section aria-label="This month" className="grid gap-3 rounded-xl bg-canvas p-3.5">
            <div className="flex items-center justify-between">
              <p className="m-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{monthLabel(u.period)} so far</p>
              {archived && <StatusBadge tone="neutral" label="Not billed: archived" />}
            </div>
            {plan.modules.includes("loads") && <UsageMeter label="Loads" used={u.loadsUsed} included={u.plan?.includedLoads ?? 0} />}
            {plan.modules.includes("gps") && (
              <div className="flex justify-between">
                <span className="font-medium">Trackers</span>
                <span className="font-semibold tabular-nums">{u.trackers}</span>
              </div>
            )}
            <div className="flex items-baseline justify-between border-t border-border pt-2.5">
              <span className="font-medium">Estimated</span>
              <span className="text-lg font-semibold tabular-nums text-[#0a2463]">{money(u.amounts.totalCents)}</span>
            </div>
            {u.longLoads > 0 && <p className="m-0 text-xs text-warning">{u.longLoads} load(s) tracked longer than 14 days this month: worth a look before invoicing.</p>}
          </section>
        )}

        {earlier.length > 0 && (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-primary hover:underline [&::-webkit-details-marker]:hidden">
              <History className="size-3.5" aria-hidden="true" /> Earlier plans ({earlier.length})
              <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <ol className="m-0 mt-3 grid list-none gap-3 border-l border-border pl-4">
              {earlier.map((h) => (
                <li key={h.id} className="relative text-xs">
                  <span aria-hidden="true" className="absolute -left-[21px] top-1 size-2.5 rounded-full border-2 border-background bg-muted-foreground/50" />
                  <p className="m-0 font-medium text-foreground">{h.planName}</p>
                  <p className="m-0 text-muted-foreground">
                    {time.date(h.startedAt)} – {time.date(h.endedAt!)} · {termsSummary(h).join(" · ")}
                  </p>
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
      {changing && <ChangePlanDialog customerId={customerId} customerName={customerName} current={plan} plans={billing.plans} onClose={() => setChanging(false)} />}
    </Card>
  );
}

type Draft = { planId: string; gps: boolean; loads: boolean; monthlyFee: string; perTracker: string; includedLoads: string; extraLoad: string; note: string; locked: Feature[]; limits: Record<LimitKey, string> };

const fromTerms = (planId: string, t: { modules: Module[]; monthlyFeeCents: number; perTrackerCents: number; includedLoads: number; extraLoadCents: number; lockedFeatures?: Feature[]; limits?: PlanLimits }): Draft => ({
  locked: [...(t.lockedFeatures ?? [])],
  limits: Object.fromEntries(LIMITS.map((k) => [k, t.limits?.[k] === undefined ? "" : String(t.limits[k])])) as Record<LimitKey, string>,
  planId,
  gps: t.modules.includes("gps"),
  loads: t.modules.includes("loads"),
  monthlyFee: (t.monthlyFeeCents / 100).toFixed(2),
  perTracker: (t.perTrackerCents / 100).toFixed(2),
  includedLoads: String(t.includedLoads),
  extraLoad: (t.extraLoadCents / 100).toFixed(2),
  note: ""
});

/**
 * Pick a plan (its standard terms fill in) and adjust anything agreed with this customer,
 * e.g. more included loads. The new terms apply from now; earlier months keep their terms.
 */
function ChangePlanDialog({ customerId, customerName, current, plans, onClose, defaultTrialDays = 14 }: { customerId: string; customerName: string; current: SubscriptionDto | null; plans: PlanDto[]; onClose: () => void; defaultTrialDays?: number }) {
  const router = useRouter();
  const offered = plans.filter((p) => p.active || p.id === current?.planId);
  const [d, setD] = useState<Draft>(() => (current?.planId && offered.some((p) => p.id === current.planId) ? fromTerms(current.planId, current) : fromTerms(offered[0]?.id ?? "", offered[0] ?? { modules: [], monthlyFeeCents: 0, perTrackerCents: 0, includedLoads: 0, extraLoadCents: 0 })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setD((s) => ({ ...s, ...patch }));
  const pick = (planId: string) => {
    const p = offered.find((x) => x.id === planId);
    if (p) setD((s) => ({ ...fromTerms(p.id, p), note: s.note }));
  };
  const losing = current ? current.modules.filter((m) => !(m === "gps" ? d.gps : d.loads)) : [];
  const [trial, setTrial] = useState(false);
  const [trialDays, setTrialDays] = useState(String(defaultTrialDays));
  const picked = offered.find((p) => p.id === d.planId);
  const returnTo = current?.trialEndsAt ? null : current?.planName;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/customers/${customerId}/plan`, {
        method: "POST",
        json: {
          planId: d.planId,
          modules: [d.gps && "gps", d.loads && "loads"].filter(Boolean),
          monthlyFee: d.monthlyFee || 0,
          perTracker: d.perTracker || 0,
          includedLoads: d.includedLoads || 0,
          extraLoad: d.extraLoad || 0,
          note: d.note || undefined,
          lockedFeatures: d.locked,
          limits: d.limits,
          ...(trial ? { trialDays: trialDays || 14 } : {})
        }
      });
      toast.success(trial ? `${customerName}: ${picked?.name ?? "plan"} trial started` : `${customerName}: plan updated`);
      onClose();
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !busy && !o && onClose()}>
      <DialogContent title="Change plan" description={`${customerName}. New terms apply from now; earlier months keep the terms they had.`} className="max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <Field id="plan" label="Plan">
            <Select id="plan" value={d.planId} onChange={(e) => pick(e.target.value)}>
              {offered.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="mb-1 p-0 text-sm font-medium">Includes</legend>
            {(["gps", "loads"] as const).map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm">
                <Checkbox checked={d[m]} onChange={(e) => set({ [m]: e.target.checked })} /> {MODULE_LABEL[m]}
              </label>
            ))}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="monthlyFee" label="Monthly fee ($)">
              <Input id="monthlyFee" inputMode="decimal" value={d.monthlyFee} onChange={(e) => set({ monthlyFee: e.target.value })} />
            </Field>
            {d.gps && (
              <Field id="perTracker" label="Per tracker per month ($)">
                <Input id="perTracker" inputMode="decimal" value={d.perTracker} onChange={(e) => set({ perTracker: e.target.value })} />
              </Field>
            )}
            {d.loads && (
              <>
                <Field id="includedLoads" label="Loads included per month" description="0 = every load is billed.">
                  <Input id="includedLoads" inputMode="numeric" value={d.includedLoads} onChange={(e) => set({ includedLoads: e.target.value.replace(/\D/g, "") })} />
                </Field>
                <Field id="extraLoad" label="Price per extra load ($)">
                  <Input id="extraLoad" inputMode="decimal" value={d.extraLoad} onChange={(e) => set({ extraLoad: e.target.value })} />
                </Field>
              </>
            )}
          </div>
          <details className="group rounded-lg border border-border">
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
              Only for this customer: features and limits
              <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="grid gap-3 border-t border-border p-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {LIMITS.map((k) => (
                  <Field key={k} id={`lim-${k}`} label={LIMIT_LABEL[k]}>
                    <Input id={`lim-${k}`} inputMode="numeric" placeholder="Unlimited" value={d.limits[k]} onChange={(e) => set({ limits: { ...d.limits, [k]: e.target.value.replace(/\D/g, "") } })} />
                  </Field>
                ))}
              </div>
              <fieldset className="m-0 grid grid-cols-1 gap-1 border-0 p-0 sm:grid-cols-2">
                <legend className="mb-1 p-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Features</legend>
                {FEATURES.map((f) => (
                  <label key={f} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={!d.locked.includes(f)} onChange={(e) => set({ locked: e.target.checked ? d.locked.filter((x) => x !== f) : [...d.locked, f] })} /> {FEATURE_LABEL[f]}
                  </label>
                ))}
              </fieldset>
            </div>
          </details>
          <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
            <Checkbox checked={trial} onChange={(e) => setTrial(e.target.checked)} className="mt-0.5" />
            <span className="grid gap-1.5">
              <span className="font-medium">Give a trial</span>
              <span className="text-xs text-muted-foreground">
                {customerName} gets {picked?.name ?? "this plan"} for the days below, then goes back to {returnTo ?? "their plan before the trial"} by itself. Nothing they add is deleted.
              </span>
              {trial && (
                <span className="flex items-center gap-2">
                  <Input aria-label="Trial length in days" inputMode="numeric" className="h-8 w-20" value={trialDays} onChange={(e) => setTrialDays(e.target.value.replace(/\D/g, ""))} /> days
                </span>
              )}
            </span>
          </label>
          <Field id="note" label="Note (optional)" description="For example: agreed by phone, 3 months at this price.">
            <Textarea id="note" rows={2} maxLength={500} value={d.note} onChange={(e) => set({ note: e.target.value })} />
          </Field>
          {losing.length > 0 && (
            <Alert tone="warning" title={`${losing.map((m) => MODULE_LABEL[m]).join(" and ")} will be switched off`}>
              The customer&apos;s users stop seeing those pages at once. Nothing is deleted; switching it back on brings everything back.
            </Alert>
          )}
          {error && <Alert tone="danger">{error}</Alert>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={!d.planId || (!d.gps && !d.loads)}>
              {trial ? "Start trial" : "Save plan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
