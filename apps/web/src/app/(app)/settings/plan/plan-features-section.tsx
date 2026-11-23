"use client";
import { FEATURE_GROUPS, FEATURE_LABEL, FEATURES, LIMIT_LABEL, type Feature, type LimitKey, type PlanLimits } from "@rio-gps/core/plan-features";
import { CheckCircle2, Hourglass, Lock, Mail, MessageCircle, Phone, Sparkles } from "lucide-react";
import { IconTitle } from "@/components/app/icon-title";
import { RequestUpgradeButton } from "@/components/app/plan/plan-ui";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { PlanAccessDto } from "@/lib/entitlements";

export interface OfferedPlan {
  id: string;
  name: string;
  priceText: string;
  lockedFeatures: Feature[];
  limits: PlanLimits;
  includedLoads: number;
  current: boolean;
}

const USAGE_KEYS: Exclude<LimitKey, "historyDays">[] = ["vehicles", "drivers", "members", "loadsPerMonth", "trackers"];

/** What's in the plan, the limits with today's usage, the other plans and how to reach RIO. */
export function PlanFeaturesSection({ access, plans, trialDaysLeft }: { access: PlanAccessDto; plans: OfferedPlan[]; trialDaysLeft: number | null }) {
  const included = FEATURES.filter((f) => !access.lockedFeatures.includes(f));
  const locked = access.lockedFeatures.filter((f) => access.lockShown.includes(f));
  const limited = USAGE_KEYS.filter((k) => access.limits[k] !== undefined);
  const days = access.limits.historyDays;
  const c = access.contact;
  return (
    <div className="mt-4 grid gap-4">
      {trialDaysLeft !== null && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          <Hourglass className="size-5 text-primary" aria-hidden="true" />
          <span className="flex-1">
            <b>{access.planName} trial</b> · {trialDaysLeft} day{trialDaysLeft === 1 ? "" : "s"} left. Nothing you add is deleted when it ends.
          </span>
          <RequestUpgradeButton size="sm">Keep {access.planName}</RequestUpgradeButton>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <Card>
          <CardHeader>
            <IconTitle icon={CheckCircle2}>What your plan includes</IconTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="m-0 mb-2 text-xs font-bold uppercase tracking-wide text-success">In your plan</p>
              <ul className="m-0 grid list-none gap-1.5 p-0 text-sm">
                {included.map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" /> {FEATURE_LABEL[f]}
                  </li>
                ))}
              </ul>
            </div>
            {locked.length > 0 && (
              <div>
                <p className="m-0 mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">With a paid plan</p>
                <ul className="m-0 grid list-none gap-1.5 p-0 text-sm text-muted-foreground">
                  {locked.map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <Lock className="size-3.5 shrink-0" aria-hidden="true" /> {FEATURE_LABEL[f]}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
        {(limited.length > 0 || days !== undefined) && (
          <Card>
            <CardHeader>
              <IconTitle icon={Sparkles}>Your limits</IconTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {limited.map((k) => {
                const max = access.limits[k]!;
                const used = access.usage[k];
                const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 100;
                return (
                  <div key={k} className="grid gap-1">
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-medium">{k === "loadsPerMonth" ? "Loads this month" : LIMIT_LABEL[k]}</span>
                      <span className="tabular-nums text-muted-foreground">{max === 0 ? <span className="inline-flex items-center gap-1"><Lock className="size-3" aria-hidden="true" /> Locked</span> : <><b className="text-foreground">{used}</b> of {max}</>}</span>
                    </div>
                    {max > 0 && (
                      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={LIMIT_LABEL[k]} aria-valuemin={0} aria-valuemax={max} aria-valuenow={used}>
                        <div className={cn("h-full rounded-full", used >= max ? "bg-warning" : "bg-primary")} style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </div>
                );
              })}
              {days !== undefined && (
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">Trip history</span>
                  <span className="text-muted-foreground">{days <= 1 ? "Today only" : `Last ${days} days`}</span>
                </div>
              )}
              <p className="m-0 text-xs text-muted-foreground">At a limit you can still see everything; adding more asks for an upgrade. Nothing is deleted.</p>
            </CardContent>
          </Card>
        )}
      </div>

      {plans.length > 1 && (
        <section aria-labelledby="plans-h" className="grid gap-3">
          <div>
            <h2 id="plans-h" className="m-0 text-base font-bold">
              Plans
            </h2>
            <p className="m-0 text-sm text-muted-foreground">Plans and prices are set by RIO GPS. Large fleets: ask about volume pricing.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {plans.map((p) => (
              <Card key={p.id} className={cn("flex flex-col gap-3 p-4", p.current && "border-primary ring-2 ring-primary/20")}>
                <div className="flex items-center justify-between gap-2">
                  <b className="text-[15px]">{p.name}</b>
                  {p.current ? <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">Your plan</span> : <span className="text-xs text-muted-foreground">Ask us</span>}
                </div>
                <p className="m-0 text-xl font-bold tabular-nums">{p.priceText}</p>
                <ul className="m-0 grid flex-1 list-none content-start gap-1 p-0 text-sm">
                  {planHighlights(p).map((h) => (
                    <li key={h} className="flex items-start gap-1.5">
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" /> {h}
                    </li>
                  ))}
                </ul>
                {!p.current && (
                  <RequestUpgradeButton variant="secondary" size="sm">
                    Request {p.name}
                  </RequestUpgradeButton>
                )}
              </Card>
            ))}
          </div>
        </section>
      )}

      {(c.phone || c.whatsapp || c.email) && (
        <Card className="flex flex-wrap items-center gap-4 p-4">
          <div className="min-w-0 flex-1">
            <b>Talk to the RIO GPS team</b>
            <p className="m-0 text-sm text-muted-foreground">{c.message || "We switch on upgrades for you, usually the same day."}</p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            {c.phone && (
              <a className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 font-semibold no-underline" href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>
                <Phone className="size-4" aria-hidden="true" /> {c.phone}
              </a>
            )}
            {c.whatsapp && (
              <a className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 font-semibold no-underline" href={`https://wa.me/${c.whatsapp.replace(/[^\d]/g, "")}`} target="_blank" rel="noreferrer">
                <MessageCircle className="size-4" aria-hidden="true" /> WhatsApp
              </a>
            )}
            {c.email && (
              <a className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 font-semibold no-underline" href={`mailto:${c.email}`}>
                <Mail className="size-4" aria-hidden="true" /> {c.email}
              </a>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function planHighlights(p: OfferedPlan): string[] {
  const out: string[] = [];
  const l = p.limits;
  out.push(l.vehicles === undefined ? "Unlimited trucks" : `${l.vehicles} truck${l.vehicles === 1 ? "" : "s"}`);
  if (l.loadsPerMonth !== undefined) out.push(`${l.loadsPerMonth} loads / month`);
  else if (p.includedLoads > 0) out.push(`${p.includedLoads} included loads / month`);
  if (l.historyDays !== undefined) out.push(l.historyDays <= 1 ? "Today's trips only" : `${l.historyDays} days of history`);
  else if (!p.lockedFeatures.includes("trip_history")) out.push("Full trip history");
  for (const g of FEATURE_GROUPS)
    for (const f of g.features)
      if (!p.lockedFeatures.includes(f) && ["gps_trackers", "alerts", "zones", "reports", "shipper_links"].includes(f)) out.push(FEATURE_LABEL[f]);
  return out.slice(0, 6);
}
