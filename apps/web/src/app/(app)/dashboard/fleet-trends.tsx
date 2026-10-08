import { type Units } from "@rio-gps/core";
import { dateFormatter, zoneAbbr } from "@rio-gps/core/timezones";
import Link from "next/link";
import { BarList, ColumnChart, Meter } from "@/components/app/charts";
import { RelativeTime } from "@/components/app/local-time";
import { Activity, Gauge, Route } from "lucide-react";
import { IconTitle } from "@/components/app/icon-title";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { CHART_RANGES, getFleetCharts, type ChartRange } from "@/lib/daily-stats";
import { getOrgSettings } from "@/lib/organization";

/** "45 min", "3h 05m", and for fleet-sized totals "4,195 h". */
const hm = (m: number) => (m < 60 ? `${m} min` : m >= 6000 ? `${Math.round(m / 60).toLocaleString("en-US")} h` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`);

/**
 * Dashboard trends. Reads the daily summary table (never raw GPS points), in the
 * organization's time zone so everyone in the company sees the same days.
 */
export async function FleetTrends({ organizationId, u, canSeeAlerts, now, days = 30 }: { organizationId: string; u: Units; canSeeAlerts: boolean; now: Date; days?: ChartRange }) {
  const org = await getOrgSettings(organizationId);
  const c = await getFleetCharts(organizationId, org.timeZone, now, days);
  // Honest about history: say so when the chosen range reaches back before the first recorded day.
  const shortHistory = c.firstDay !== null && c.mileage[0] !== undefined && c.firstDay > c.mileage[0].day;
  const f = dateFormatter(org.timeZone, org.timeFormat);
  const total = c.mileage.reduce((s, d) => s + d.distanceKm, 0);
  const activeDays = c.mileage.filter((d) => d.distanceKm > 0).length;
  const points = c.mileage.map((d) => ({
    key: d.day,
    label: f.day(d.day).replace(/^\w+, /, ""), // "Sep 25"
    longLabel: f.day(d.day),
    value: u.dist(d.distanceKm),
    valueLabel: u.fmtDist(d.distanceKm)
  }));
  const pct = c.idling.ratio === null ? null : Math.round(c.idling.ratio * 100);

  return (
    <section id="trends" aria-label="Fleet trends" className="scroll-mt-20 mt-5 grid grid-cols-1 gap-5 lg:grid-cols-5">
      <Card className="min-w-0 lg:col-span-3">
        <CardHeader>
          <IconTitle
            icon={Route}
            sub={
              total > 0 ? (
                <>
                  <span className="font-medium text-foreground">{u.fmtDist(total)}</span> in total · {u.fmtDist(total / Math.max(1, activeDays))} per driving day
                </>
              ) : (
                "Distance driven by all vehicles, per day."
              )
            }
          >
            Fleet mileage, last {days} days
          </IconTitle>
          <div className="flex shrink-0 items-center gap-3">
            <nav aria-label="Chart range">
              <ul className="m-0 inline-flex list-none gap-0.5 rounded-md bg-muted p-0.5">
                {CHART_RANGES.map((r) => (
                  <li key={r}>
                    <Link
                      href={r === 30 ? "/dashboard#trends" : `/dashboard?range=${r}#trends`}
                      scroll={false}
                      aria-current={r === days ? "true" : undefined}
                      aria-label={`Last ${r} days`}
                      className={cn("inline-flex h-7 items-center rounded px-2 text-xs font-medium no-underline", r === days ? "bg-background font-semibold text-primary shadow-card" : "text-muted-foreground hover:text-foreground")}
                    >
                      {r}d
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <Link href="/reports/mileage" className="text-sm text-primary no-underline hover:underline">
              Mileage report
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {total > 0 ? (
            <ColumnChart data={points} labelEvery={days === 7 ? 1 : days === 30 ? 7 : 14} ariaLabel={`Fleet distance per day for the last ${days} days, ${u.fmtDist(total)} in total`} tableHeads={["Day", `Distance (${u.distance})`]} />
          ) : (
            <p className="m-0 py-8 text-center text-sm text-muted-foreground">No driving recorded in the last {days} days. The chart fills in as your vehicles drive.</p>
          )}
          <p className="m-0 mt-3 text-xs text-muted-foreground">
            Days in {zoneAbbr(org.timeZone, now)} (organization time zone).{" "}
            {shortHistory && <>Daily totals start on {f.day(c.firstDay!)}. </>}
            {c.updatedAt && (
              <>
                Updated <RelativeTime iso={c.updatedAt} />.
              </>
            )}
          </p>
        </CardContent>
      </Card>

      <div className="grid min-w-0 grid-cols-1 content-start gap-5 lg:col-span-2">
        <Card>
          <CardHeader>
            <IconTitle icon={Activity} tone="amber">Idling, last 7 days</IconTitle>
            <Link href="/reports/idling" className="shrink-0 text-sm text-primary no-underline hover:underline">
              Idling report
            </Link>
          </CardHeader>
          <CardContent>
            {pct === null ? (
              <p className="m-0 text-sm text-muted-foreground">No engine-on time recorded in the last 7 days.</p>
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-semibold tabular-nums text-warning">{pct}%</span>
                  <span className="text-sm text-muted-foreground">of engine-on time</span>
                </div>
                <div className="mt-3">
                  <Meter value={c.idling.ratio!} label="Share of engine-on time spent idling" tone="warning" />
                </div>
                <p className="m-0 mt-2 text-[13px] text-muted-foreground">
                  {hm(c.idling.idleMin)} idling · {hm(c.idling.drivingMin)} driving
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {canSeeAlerts && (
          <Card>
            <CardHeader>
              <IconTitle icon={Gauge} tone="red">Top speeding vehicles, last 7 days</IconTitle>
            </CardHeader>
            <CardContent>
              {c.speeding.length === 0 ? (
                <p className="m-0 text-sm text-muted-foreground">
                  No speeding alerts in the last 7 days. Alerts come from your speed rules; <Link href="/alerts">set one up</Link> or use the <Link href="/reports/speeding">speeding report</Link>.
                </p>
              ) : (
                <BarList
                  tone="danger"
                  ariaLabel="Vehicles with the most speeding alerts in the last 7 days"
                  rows={c.speeding.map((s) => ({
                    key: s.vehicle,
                    label: s.vehicle,
                    value: s.events,
                    valueLabel: `${s.events} ${s.events === 1 ? "alert" : "alerts"}`,
                    sub: s.maxSpeedKph ? `top ${u.fmtSpeed(s.maxSpeedKph)}` : undefined
                  }))}
                />
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  );
}

export function TrendsSkeleton() {
  return (
    <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-5" aria-busy="true" aria-label="Loading fleet trends">
      <Skeleton className="h-72 lg:col-span-3" />
      <div className="grid gap-5 lg:col-span-2">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    </div>
  );
}
