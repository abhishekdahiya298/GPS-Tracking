"use client";
import { FEATURE_LABEL, FEATURE_PITCH } from "@rio-gps/core/plan-features";
import { Lock, Sparkles } from "lucide-react";
import Link from "next/link";
import { RequestUpgradeButton, usePlan } from "@/components/app/plan/plan-ui";
import { IconTitle } from "@/components/app/icon-title";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

/** Most wanted first. */
const ORDER = ["trip_history", "alerts", "reports", "gps_trackers", "zones", "maintenance", "shipper_links", "emailed_reports", "csv_export", "loads_map", "team", "mobile_app", "loads", "drivers", "vehicles", "live_map"];

/** "Not in your plan": the locked features worth asking about, with Compare plans and Request upgrade. */
export function NotInPlanCard() {
  const { plan } = usePlan();
  if (!plan || plan.lockShown.length === 0) return null;
  const items = [...plan.lockShown].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).slice(0, 6);
  return (
    <Card className="min-w-0">
      <CardHeader>
        <IconTitle icon={Lock} tone="amber">
          Not in your plan
        </IconTitle>
        <span className="text-xs font-semibold text-muted-foreground">{plan.planName}</span>
      </CardHeader>
      <ul className="m-0 list-none divide-y divide-border p-0">
        {items.map((f) => (
          <li key={f} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
            <span className="min-w-0 flex-1">
              <b className="block truncate text-sm">{FEATURE_LABEL[f]}</b>
              <span className="block truncate text-xs text-muted-foreground">{FEATURE_PITCH[f]}</span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning">
              <Lock className="size-3" aria-hidden="true" /> Locked
            </span>
          </li>
        ))}
      </ul>
      <CardContent className="grid grid-cols-2 gap-2 border-t border-border pt-3">
        <Link href="/settings/plan" className="inline-flex h-9 items-center justify-center rounded-md border border-border text-sm font-semibold no-underline hover:bg-muted">
          Compare plans
        </Link>
        <RequestUpgradeButton size="sm">
          <Sparkles /> Request upgrade
        </RequestUpgradeButton>
      </CardContent>
    </Card>
  );
}
