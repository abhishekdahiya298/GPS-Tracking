"use client";
import { FEATURE_LABEL, FEATURE_PITCH, LIMIT_NOUN, type LimitKey } from "@rio-gps/core/plan-features";
import { Lock, Sparkles } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { RequestUpgradeButton, usePlan } from "./plan-ui";

/** Most wanted first. */
const ORDER = ["gps_trackers", "trip_history", "alerts", "reports", "zones", "maintenance", "shipper_links", "emailed_reports", "csv_export", "loads_map", "team", "mobile_app", "loads", "drivers", "vehicles", "live_map"];
const KEYS: Exclude<LimitKey, "historyDays" | "trackers">[] = ["vehicles", "drivers", "loadsPerMonth"];

/**
 * Dashboard strip for plans with limits (Free Basic): usage against the limits and what a paid
 * plan adds. Nothing is shown on plans without limits or locks.
 */
export function PlanStrip({ className }: { className?: string }) {
  const { plan } = usePlan();
  if (!plan || (plan.lockedFeatures.length === 0 && Object.keys(plan.limits).length === 0)) return null;
  const keys = KEYS.filter((k) => plan.limits[k] !== undefined);
  return (
    <Card className={cn("mb-5 grid gap-4 p-4", className)}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-xs font-bold uppercase tracking-wide text-primary">Your plan</p>
          <p className="m-0 text-lg font-bold">{plan.planName}</p>
        </div>
        <Link href="/settings/plan" className="text-sm font-semibold no-underline">
          Compare plans
        </Link>
        <RequestUpgradeButton size="sm">
          <Sparkles /> Request upgrade
        </RequestUpgradeButton>
      </div>
      {keys.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {keys.map((k) => {
            const max = plan.limits[k]!;
            const used = plan.usage[k];
            return (
              <div key={k} className="rounded-xl bg-muted/50 p-3">
                <p className="m-0 text-xs text-muted-foreground">{LIMIT_NOUN[k][0]!.toUpperCase() + LIMIT_NOUN[k].slice(1)}</p>
                <p className="m-0 text-xl font-bold tabular-nums">
                  {used} <span className="text-sm font-medium text-muted-foreground">of {max}</span>
                </p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-background" aria-hidden="true">
                  <div className={cn("h-full rounded-full", used >= max ? "bg-warning" : "bg-primary")} style={{ width: `${max > 0 ? Math.min(100, (used / max) * 100) : 100}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
      {plan.lockShown.length > 0 && (
        <div>
          <p className="m-0 mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Not in your plan</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {[...plan.lockShown].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).slice(0, 6).map((f) => (
              <div key={f} className="flex items-center gap-2.5 rounded-xl border border-border px-3 py-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                  <Lock className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 leading-tight">
                  <span className="block truncate text-sm font-semibold">{FEATURE_LABEL[f]}</span>
                  <span className="block truncate text-xs text-muted-foreground">{f === "trip_history" && plan.limits.historyDays !== undefined ? "Free shows today only" : FEATURE_PITCH[f]}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
