import type { Module } from "@rio-gps/core";

/** Display helpers shared by the customer Plan page and the platform console (client-safe). */
export const MODULE_LABEL: Record<Module, string> = { gps: "GPS tracking", loads: "Loads" };

export const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "2026-11" → "November 2026". */
export function monthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "2026-11" → "2026-10". */
export function previousPeriod(period: string, back = 1): string {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 - back, 15));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Plain-language price summary of a plan's terms. */
export function termsSummary(t: { modules: Module[]; includedLoads: number; extraLoadCents: number; monthlyFeeCents: number; perTrackerCents: number }): string[] {
  const out: string[] = [];
  if (t.monthlyFeeCents === 0 && (!t.modules.includes("gps") || t.perTrackerCents === 0) && (!t.modules.includes("loads") || t.extraLoadCents === 0)) return ["Free: nothing is charged"];
  if (t.monthlyFeeCents > 0) out.push(`${money(t.monthlyFeeCents)} per month`);
  if (t.modules.includes("gps")) out.push(`${money(t.perTrackerCents)} per tracker per month`);
  if (t.modules.includes("loads")) {
    if (t.includedLoads > 0) out.push(`${t.includedLoads.toLocaleString("en-US")} loads included each month`);
    out.push(t.includedLoads > 0 ? `${money(t.extraLoadCents)} per extra load` : `${money(t.extraLoadCents)} per load`);
  }
  return out;
}

/** The rules, in the words customers see (only those that apply to their plan). */
export function countingRules(modules: readonly Module[]): string[] {
  const loads = modules.includes("loads");
  const gps = modules.includes("gps");
  return [
    ...(loads
      ? [
          gps
            ? "A load counts once, in the month it starts tracking: when the driver accepts the link, or when a load tracked by one of your vehicles is created."
            : "A load counts once, in the month it starts tracking: when the driver accepts the link.",
          "Loads cancelled or declined before tracking starts are free.",
          "Deleting or cancelling a load after it started tracking doesn't remove it from that month."
        ]
      : []),
    ...(gps ? ["A tracker counts once for each month it is in your account, whatever the day it arrived or left."] : []),
    "Months are calendar months in your company's time zone.",
    ...(loads ? ["Going over your included loads never stops your work; extra loads are added to that month's invoice."] : [])
  ];
}
