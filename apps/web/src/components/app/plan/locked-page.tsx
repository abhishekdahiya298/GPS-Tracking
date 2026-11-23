"use client";
import { FEATURE_LABEL, FEATURE_PITCH, type Feature } from "@rio-gps/core/plan-features";
import { Check, Lock, Sparkles } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { UpgradeContact } from "@/lib/entitlements";
import { ContactLine, RequestUpgradeButton } from "./plan-ui";

/** What each paid feature brings, in a few words (lock pages). */
const BENEFITS: Partial<Record<Feature, string[]>> = {
  gps_trackers: ["Trailers and parked trucks too", "Ignition, idling and speeding", "We ship it with an install guide"],
  trip_history: ["Replay any day, stop by stop", "Distance, driving and idling", "Up to a year back"],
  alerts: ["Speeding and harsh driving", "Arrivals and departures at zones", "Idling and no signal"],
  zones: ["Yards, customers and borders", "Arrive and leave alerts", "Time spent at each place"],
  reports: ["Mileage by vehicle and state", "Stops, idling and speeding", "Download or email them"],
  emailed_reports: ["Weekly or monthly, by email", "To anyone on your team", "No sign-in needed"],
  maintenance: ["Service reminders by miles or date", "Registration and insurance renewals", "History for every vehicle"],
  loads_map: ["All loads on one map", "Late loads stand out", "Open any load in one tap"],
  loads: ["The driver gets a link", "Live position while on duty", "Proof of delivery"]
};

/**
 * Shown instead of a page whose feature isn't in the customer's plan: what it does, and a way
 * to ask for it. The menu item stays visible with a lock (unless the platform hides it).
 */
export function LockedPage({ feature, title, description, contact }: { feature: Feature; title: string; description?: string; contact: UpgradeContact }) {
  const benefits = BENEFITS[feature] ?? [FEATURE_PITCH[feature]];
  return (
    <div className="grid gap-5">
      <PageHeader title={title} description={description} />
      <Card className="mx-auto grid w-full max-w-2xl justify-items-center gap-4 px-6 py-10 text-center">
        <span className="grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Lock className="size-7" aria-hidden="true" />
        </span>
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Not in your plan</span>
        <h2 className="m-0 text-xl font-bold">{FEATURE_LABEL[feature]}</h2>
        <p className="m-0 max-w-md text-sm text-muted-foreground">Available on a paid plan. {FEATURE_PITCH[feature]}. Ask us and we&apos;ll switch it on, usually the same day.</p>
        <ul className="m-0 grid list-none gap-2 p-0 text-left text-sm">
          {benefits.map((b) => (
            <li key={b} className="flex items-center gap-2">
              <Check className="size-4 text-success" aria-hidden="true" /> {b}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap justify-center gap-2 pt-2">
          <Link href="/settings/plan" className={buttonVariants({ variant: "secondary" })}>
            Compare plans
          </Link>
          <RequestUpgradeButton need={feature}>
            <Sparkles /> Request upgrade
          </RequestUpgradeButton>
        </div>
        <ContactLine contact={contact} />
      </Card>
    </div>
  );
}
