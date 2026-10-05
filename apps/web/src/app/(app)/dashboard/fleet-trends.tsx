import { type Units } from "@rio-gps/core";
import { dateFormatter, zoneAbbr } from "@rio-gps/core/timezones";
import Link from "next/link";
import { BarList, ColumnChart, Meter } from "@/components/app/charts";
import { RelativeTime } from "@/components/app/local-time";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getFleetCharts } from "@/lib/daily-stats";
import { getOrgSettings } from "@/lib/organization";

/** "45 min", "3h 05m", and for fleet-sized totals "4,195 h". */
const hm = (m: number) => (m < 60 ? `${m} min` : m >= 6000 ? `${Math.round(m / 60).toLocaleString("en-US")} h` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`);

/**
 * Dashboard trends. Reads the daily summary table (never raw GPS points), in the
 * organization's time zone so everyone in the company sees the same days.
 */
export async function FleetTrends({ organizationId, u, canSeeAlerts, now }: { organizationId: string; u: Units; canSeeAlerts: boolean; now: Date }) {
  const org = await getOrgSettings(organizationId);
  const c = await getFleetCharts(organizationId, org.timeZone, now);
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
    <section aria-label="Fleet trends" className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-5">
      <Card className="min-w-0 lg:col-span-3">
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>Fleet mileage, last 30 days</CardTitle>
            <p className="m-0 mt-0.5 text-[13px] text-muted-foreground">
              {total > 0 ? (
                <>
                  <span className="font-medium text-foreground">{u.fmtDist(total)}</span> in total · {u.fmtDist(total / Math.max(1, activeDays))} per driving day
                </>
              ) : (
                "Distance driven by all vehicles, per day."
              )}
            </p>
          </div>
          <Link href="/reports/mileage" className="shrink-0 text-[13px] font-medium">
            Mileage report
          </Link>
        </CardHeader>
        <CardContent>
          {total > 0 ? (
            <ColumnChart data={points} ariaLabel={`Fleet distance per day for the last 30 days, ${u.fmtDist(total)} in total`} tableHeads={["Day", `Distance (${u.distance})`]} />
          ) : (
            <p className="m-0 py-8 text-center text-sm text-muted-foreground">No driving recorded in the last 30 days. The chart fills in as your vehicles drive.</p>
          )}
          <p className="m-0 mt-3 text-xs text-muted-foreground">
            Days in {zoneAbbr(org.timeZone, now)} (organization time zone).{" "}
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
            <CardTitle>Idling, last 7 days</CardTitle>
            <Link href="/reports/idling" className="shrink-0 text-[13px] font-medium">
              Idling report
            </Link>
          </CardHeader>
          <CardContent>
            {pct === null ? (
              <p className="m-0 text-sm text-muted-foreground">No engine-on time recorded in the last 7 days.</p>
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-semibold">{pct}%</span>
                  <span className="text-sm text-muted-foreground">of engine-on time</span>
                </div>
                <div className="mt-3">
                  <Meter value={c.idling.ratio!} label="Share of engine-on time spent idling" />
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
              <CardTitle>Top speeding vehicles, last 7 days</CardTitle>
            </CardHeader>
            <CardContent>
              {c.speeding.length === 0 ? (
                <p className="m-0 text-sm text-muted-foreground">
                  No speeding alerts in the last 7 days. Alerts come from your speed rules; <Link href="/alerts">set one up</Link> or use the <Link href="/reports/speeding">speeding report</Link>.
                </p>
              ) : (
                <BarList
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
