"use client";
import type { Module } from "@rio-gps/core";
import { ArrowRightLeft, History } from "lucide-react";
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
export function CustomerPlanCard({ customerId, customerName, billing }: { customerId: string; customerName: string; billing: CustomerBilling }) {
  const time = useTime();
  const [changing, setChanging] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const plan = billing.history.find((h) => !h.endedAt) ?? null;
  const u = billing.usage;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>Plan</CardTitle>
        <Button size="sm" variant="secondary" onClick={() => setChanging(true)}>
          <ArrowRightLeft /> Change plan
        </Button>
      </CardHeader>
      <div className="grid gap-4 px-4 pb-4 text-sm">
        {plan ? (
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold">{plan.planName}</span>
              {plan.modules.map((m) => (
                <StatusBadge key={m} tone={m === "gps" ? "info" : "success"} label={MODULE_LABEL[m]} />
              ))}
            </div>
            <p className="m-0 text-muted-foreground">{termsSummary(plan).join(" · ")}</p>
            <p className="m-0 text-xs text-muted-foreground">
              Since {time.date(plan.startedAt)}
              {plan.changedByName ? ` · set by ${plan.changedByName}` : ""}
              {plan.note ? ` · ${plan.note}` : ""}
            </p>
          </div>
        ) : (
          <Alert tone="warning" title="No plan recorded">
            Until a plan is set, this customer has every module. Choose a plan.
          </Alert>
        )}

        {u && plan && (
          <div className="grid gap-3 rounded-lg border border-border p-3">
            <p className="m-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{monthLabel(u.period)} so far</p>
            {plan.modules.includes("loads") && <UsageMeter label="Loads" used={u.loadsUsed} included={u.plan?.includedLoads ?? 0} />}
            {plan.modules.includes("gps") && (
              <div className="flex justify-between">
                <span className="font-medium">Trackers</span>
                <span className="font-semibold tabular-nums">{u.trackers}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-border pt-2">
              <span className="font-medium">Estimated</span>
              <span className="font-semibold tabular-nums">{money(u.amounts.totalCents)}</span>
            </div>
            {u.longLoads > 0 && <p className="m-0 text-xs text-warning">{u.longLoads} load(s) tracked longer than 14 days this month: worth a look before invoicing.</p>}
          </div>
        )}

        {billing.history.length > 1 && (
          <div>
            <button type="button" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
              <History className="size-3.5" aria-hidden="true" /> {showHistory ? "Hide" : "Show"} plan history ({billing.history.length})
            </button>
            {showHistory && (
              <ol className="m-0 mt-2 grid list-none gap-2 p-0">
                {billing.history.map((h) => (
                  <li key={h.id} className="rounded-md bg-muted/50 px-3 py-2 text-xs">
                    <div className="font-medium text-foreground">{h.planName}</div>
                    <div className="text-muted-foreground">
                      {time.date(h.startedAt)} – {h.endedAt ? time.date(h.endedAt) : "now"} · {termsSummary(h).join(" · ")}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
      {changing && <ChangePlanDialog customerId={customerId} customerName={customerName} current={plan} plans={billing.plans} onClose={() => setChanging(false)} />}
    </Card>
  );
}

type Draft = { planId: string; gps: boolean; loads: boolean; monthlyFee: string; perTracker: string; includedLoads: string; extraLoad: string; note: string };

const fromTerms = (planId: string, t: { modules: Module[]; monthlyFeeCents: number; perTrackerCents: number; includedLoads: number; extraLoadCents: number }): Draft => ({
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
function ChangePlanDialog({ customerId, customerName, current, plans, onClose }: { customerId: string; customerName: string; current: SubscriptionDto | null; plans: PlanDto[]; onClose: () => void }) {
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
          note: d.note || undefined
        }
      });
      toast.success(`${customerName}: plan updated`);
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
              Save plan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
