import { contextHasPermission, units, type TenantContext, type Units } from "@rio-gps/core";
import { Activity, AlertTriangle, PieChart, Zap, CheckCircle2, CalendarClock, ArrowRight, Bell, CircleOff, CircleParking, Hexagon, Map as MapIcon, Navigation, Package, Plus, Route, Truck, Users, Wrench } from "lucide-react";
import Link from "next/link";
import { CHART_RANGES, type ChartRange } from "@/lib/daily-stats";
import { VehicleTypeIcon } from "@/components/app/vehicle-type-icon";
import { cache, Suspense } from "react";
import { LocalTime } from "@/components/app/local-time";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { alertMeta } from "@/lib/alert-meta";
import { listEvents } from "@/lib/alerts";
import { cn } from "@/lib/cn";
import { getServerEnv } from "@/lib/env";
import { FLEET_STATE_META, fleetState, type FleetState } from "@/lib/fleet-status";
import { durationMin, relativeTime } from "@/lib/format";
import { listCurrentLocations, type CurrentDeviceLocation } from "@/lib/locations";
import { dueCounts } from "@/lib/maintenance";
import { renewalCounts } from "@/lib/renewals";
import { buildTripReport } from "@/lib/reports";
import { requireTenantPage, getUnacknowledgedAlertCount } from "@/lib/request-context";
import { FleetGlance } from "./fleet-glance";
import { greeting, Hero, QuickAction, Tile } from "./parts";
import { DeliveriesCard, LoadAttentionCard, LoadTiles, LoadUsageCard, TodayStopsCard } from "./loads-panels";
import { getLoadDashboard } from "@/lib/load-dashboard";
import { currentUsage } from "@/lib/plans";
import { FleetTrends, TrendsSkeleton } from "./fleet-trends";
import { IconTitle } from "@/components/app/icon-title";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard · RIO GPS" };

/** Trip summary covers the vehicles most recently seen, to keep the page fast on big fleets. */
const TRIP_SUMMARY_MAX_DEVICES = 25;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const rangeParam = Number((await searchParams).range);
  const chartDays: ChartRange = (CHART_RANGES as readonly number[]).includes(rangeParam) ? (rangeParam as ChartRange) : 30;
  const rc = await requireTenantPage("/dashboard");
  const { ctx, user, unitSystem } = rc;
  const u = units(unitSystem);
  const now = new Date();
  const can = (p: Parameters<typeof contextHasPermission>[1]) => contextHasPermission(ctx, p);
  const hasGps = can("locations.read");
  const hasLoads = can("loads.read");

  const [devices, unack, maint, renewals, recentAlerts, loadsDash, usage] = await Promise.all([
    can("locations.read") ? listCurrentLocations(ctx.organizationId, now, getServerEnv().GPS_DEVICE_OFFLINE_THRESHOLD_SECONDS) : Promise.resolve([] as CurrentDeviceLocation[]),
    can("alerts.read") ? getUnacknowledgedAlertCount(ctx.organizationId) : Promise.resolve(0),
    can("maintenance.read") ? dueCounts(ctx.organizationId, now) : Promise.resolve(null),
    can("maintenance.read") ? renewalCounts(ctx.organizationId, now) : Promise.resolve(null),
    can("alerts.read") ? listEvents(ctx.organizationId, { limit: 5, unacknowledgedOnly: false }) : Promise.resolve([]),
    hasLoads ? getLoadDashboard(ctx.organizationId, rc.timeZone, now) : Promise.resolve(null),
    hasLoads && can("billing.read") ? currentUsage(ctx.organizationId, now) : Promise.resolve(null)
  ]);
  const loadUsage = usage?.plan?.modules.includes("loads") ? { loadsUsed: usage.loadsUsed, included: usage.plan.includedLoads, extraLoadCents: usage.plan.extraLoadCents } : null;
  const dateLabel = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: rc.timeZone }).format(now);
  const hello = `${greeting(now, rc.timeZone)}${(user.name || "").split(" ")[0] ? `, ${(user.name || "").split(" ")[0]}` : ""}`;
  const loadsSummary = loadsDash ? `${loadsDash.active} active load${loadsDash.active === 1 ? "" : "s"}${loadsDash.counts.attention ? ` · ${loadsDash.counts.attention} need${loadsDash.counts.attention === 1 ? "s" : ""} attention` : ""}` : "";

  // Loads plan: the dashboard is about loads (same building blocks as the fleet dashboard).
  if (!hasGps && loadsDash) {
    return (
      <>
        <Hero greeting={hello} orgName={rc.orgName} dateLabel={dateLabel} summary={`${loadsSummary}${unack > 0 ? ` · ${unack} unread alert${unack === 1 ? "" : "s"}` : ""}`} action={{ href: "/loads/map", label: "Open loads map", icon: MapIcon }} />
        <div className="mb-5">
          <LoadTiles d={loadsDash} />
        </div>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
          <div className="grid min-w-0 content-start gap-5 lg:col-span-3">
            <LoadAttentionCard d={loadsDash} />
            <DeliveriesCard d={loadsDash} timeZone={rc.timeZone} timeFormat={rc.timeFormat} />
            {can("alerts.read") && <RecentAlertsCard alerts={recentAlerts} now={now} timeZone={rc.timeZone} canWrite={can("alerts.write")} emptyHint="Late, no-signal and delivery alerts will appear here." />}
          </div>
          <div className="grid min-w-0 content-start gap-5 lg:col-span-2">
            <TodayStopsCard d={loadsDash} timeZone={rc.timeZone} timeFormat={rc.timeFormat} />
            <LoadUsageCard used={loadUsage} />
            <Card>
              <CardHeader>
                <IconTitle icon={Zap}>Quick actions</IconTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
                {can("loads.write") && <QuickAction href="/loads/new" icon={Plus} label="New load" hint="Send the driver a link" tone="green" />}
                <QuickAction href="/loads/map" icon={MapIcon} label="Loads map" hint="Every active load now" tone="navy" />
                <QuickAction href="/loads" icon={Package} label="All loads" hint="Search, filter, share" tone="purple" />
                {can("users.manage") && <QuickAction href="/settings/team" icon={Users} label="Invite your team" hint="Dispatchers and viewers" tone="amber" />}
              </CardContent>
            </Card>
          </div>
        </div>
      </>
    );
  }

  /** GPS + Loads: the loads at a glance, between the fleet overview and the trends. */
  const loadsSection = loadsDash ? (
    <section aria-label="Loads" className="mt-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="m-0 flex items-center gap-2 text-lg font-semibold text-[#0a2463]">
          <Package className="size-5" aria-hidden="true" /> Loads
          <span className="text-sm font-normal text-muted-foreground">{loadsSummary}</span>
        </h2>
        <Link href="/loads" className="text-sm text-primary no-underline hover:underline">
          All loads
        </Link>
      </div>
      <LoadTiles d={loadsDash} />
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <LoadAttentionCard d={loadsDash} limit={4} />
        <TodayStopsCard d={loadsDash} timeZone={rc.timeZone} timeFormat={rc.timeFormat} />
      </div>
    </section>
  ) : null;

  const states = devices.map((d) => ({ d, s: fleetState(d) }));
  const count = (s: FleetState) => states.filter((x) => x.s === s).length;
  const firstName = (user.name || "").split(" ")[0];
  // Moving, Idling, Stopped, Offline, and Alerts for people who can see them.
  const tileCount = 4 + (can("alerts.read") ? 1 : 0);

  if (devices.length === 0) {
    return (
      <>
        <PageHeader title={firstName ? `Welcome, ${firstName}` : "Welcome"} description="Here's how to start tracking your fleet." />
        <Card>
          <EmptyState
            icon={Truck}
            title="No vehicles are reporting yet"
            description="Add a vehicle, then assign a GPS device to it. Positions appear on the live map as soon as the device reports."
            action={
              <>
                {can("vehicles.create") && (
                  <Button asChild>
                    <Link href="/vehicles">
                      <Plus aria-hidden="true" /> Add vehicle
                    </Link>
                  </Button>
                )}
                {ctx.isSuperAdmin && (
                  <Button asChild variant="secondary">
                    <Link href="/admin/customers">Register device</Link>
                  </Button>
                )}
              </>
            }
          />
        </Card>
        {loadsSection}
      </>
    );
  }

  return (
    <>
      <Hero
        greeting={`${greeting(now, rc.timeZone)}${firstName ? `, ${firstName}` : ""}`}
        orgName={rc.orgName}
        dateLabel={new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: rc.timeZone }).format(now)}
        summary={`${count("moving")} of ${devices.length} vehicle${devices.length === 1 ? "" : "s"} on the road${loadsDash ? ` · ${loadsSummary}` : ""}${unack > 0 ? ` · ${unack} unread alert${unack === 1 ? "" : "s"}` : ""}`}
        action={can("locations.read") ? { href: "/map", label: "Open live map" } : undefined}
      />

      <section aria-label="Fleet summary" className={cn("stagger-in mb-5 grid grid-cols-2 gap-3", tileCount === 5 ? "md:grid-cols-5" : "md:grid-cols-4")}>
        <Tile label="Moving" value={count("moving")} total={devices.length} icon={Navigation} look="moving" href="/vehicles?state=moving" />
        <Tile label="Idling" value={count("idle")} total={devices.length} icon={Activity} look="idle" hint="engine on" href="/vehicles?state=idle" />
        <Tile label="Stopped" value={count("stopped") + count("parked")} total={devices.length} icon={CircleParking} look="stopped" href="/vehicles?state=stopped" />
        <Tile label="Offline" value={count("offline") + count("never_seen")} total={devices.length} icon={CircleOff} look="offline" href="/vehicles?state=offline" />
        {can("alerts.read") && <Tile label="Unread alerts" value={unack} icon={Bell} look={unack > 0 ? "alert" : "calm"} href="/alerts" className="col-span-2 md:col-span-1" />}
      </section>

      {/* Things that need attention sit side by side on wide screens instead of stacking. */}
      <div className="mb-5 grid gap-3 empty:hidden md:grid-flow-col md:auto-cols-fr">
      {maint && maint.overdue > 0 && (
        <Link href="/maintenance" className="flex items-center gap-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-foreground no-underline hover:border-danger/50">
          <Wrench className="size-4 shrink-0 text-danger" aria-hidden="true" />
          <span className="flex-1">
            <strong>{maint.overdue}</strong> maintenance item{maint.overdue === 1 ? " is" : "s are"} overdue{maint.dueSoon ? `, ${maint.dueSoon} due soon` : ""}.
          </span>
          <span className="font-medium text-danger">Review</span>
        </Link>
      )}

      {renewals && (renewals.overdue > 0 || renewals.dueSoon > 0) && (
        <Link
          href="/maintenance/renewals"
          className={cn(
            "flex items-center gap-3 rounded-lg border px-4 py-3 text-sm text-foreground no-underline",
            renewals.overdue > 0 ? "border-danger/30 bg-danger-soft hover:border-danger/50" : "border-warning/30 bg-warning-soft hover:border-warning/50"
          )}
        >
          <CalendarClock className={cn("size-4 shrink-0", renewals.overdue > 0 ? "text-danger" : "text-warning")} aria-hidden="true" />
          <span className="flex-1">
            {renewals.overdue > 0 ? (
              <>
                <strong>{renewals.overdue}</strong> renewal{renewals.overdue === 1 ? " has" : "s have"} expired{renewals.dueSoon ? `, ${renewals.dueSoon} due soon` : ""}.
              </>
            ) : (
              <>
                <strong>{renewals.dueSoon}</strong> renewal{renewals.dueSoon === 1 ? " is" : "s are"} due soon.
              </>
            )}
          </span>
          <span className={cn("font-medium", renewals.overdue > 0 ? "text-danger" : "text-warning")}>Review</span>
        </Link>
      )}
      </div>

      {can("locations.read") && <FleetGlance offlineSeconds={getServerEnv().GPS_DEVICE_OFFLINE_THRESHOLD_SECONDS} />}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <Card className="min-w-0 lg:col-span-3">
          <CardHeader>
            <IconTitle icon={PieChart}>Fleet status</IconTitle>
            <Link href="/vehicles" className="text-sm text-primary no-underline hover:underline">
              All vehicles
            </Link>
          </CardHeader>
          <StatusDonut
            total={devices.length}
            parts={(["moving", "idle", "stopped", "offline"] as const).map((k) => ({
              key: k,
              label: FLEET_STATE_META[k].label,
              color: FLEET_STATE_META[k].color,
              value: k === "offline" ? count("offline") + count("never_seen") : k === "stopped" ? count("stopped") + count("parked") : count(k)
            }))}
          />
          <ul className="m-0 list-none divide-y divide-border border-t border-border p-0">
            {states
              .sort((a, b) => rank(a.s) - rank(b.s))
              .slice(0, 8)
              .map(({ d, s }) => (
                <li key={d.deviceId}>
                  <Link href={`/map?focus=${d.deviceId}`} className="flex items-center gap-3 px-4 py-3 text-foreground no-underline hover:bg-canvas sm:px-5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground [--vehicle-icon-gap:var(--color-muted)]">
                      <VehicleTypeIcon type={d.vehicle?.type ?? "other"} className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{d.vehicle?.name ?? d.name ?? d.model ?? "Device"}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {d.location ? `${u.fmtSpeed(d.location.speedKph)} · engine ${d.location.ignition === true ? "on" : d.location.ignition === false ? "off" : "unknown"} · ` : ""}
                        last update {relativeTime(d.lastSeenAt, now.getTime(), rc.timeZone)}
                      </span>
                    </span>
                    <StatusBadge tone={FLEET_STATE_META[s].tone} label={FLEET_STATE_META[s].label} pulse={s === "moving"} />
                  </Link>
                </li>
              ))}
          </ul>
          {devices.length > 8 && <p className="m-0 border-t border-border px-5 py-2.5 text-xs text-muted-foreground">Showing 8 of {devices.length}. Moving vehicles first.</p>}
        </Card>

        <div className="grid min-w-0 grid-cols-1 content-start gap-5 lg:col-span-2">
          {can("alerts.read") && <RecentAlertsCard alerts={recentAlerts} now={now} timeZone={rc.timeZone} canWrite={can("alerts.write")} emptyHint={loadsDash ? "Speeding, zone, offline and load alerts will appear here." : "Speeding, zone and offline alerts will appear here."} />}

          <Card>
            <CardHeader>
              <IconTitle icon={Zap}>Quick actions</IconTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
              {can("locations.read") && <QuickAction href="/map" icon={MapIcon} label="Live map" hint="Every vehicle now" tone="navy" />}
              {can("loads.write") && <QuickAction href="/loads/new" icon={Package} label="New load" hint="Track a shipment" tone="red" />}
              {can("vehicles.create") && <QuickAction href="/vehicles" icon={Plus} label="Add vehicle" hint="Truck, trailer, van" tone="green" />}
              {can("geofences.write") && <QuickAction href="/geofences" icon={Hexagon} label="Create zone" hint="Yards and sites" tone="purple" />}
              {can("history.read") && <QuickAction href="/reports" icon={Route} label="Trip reports" hint="Trips, stops, miles" tone="amber" />}
              {can("alerts.write") && !can("vehicles.create") && <QuickAction href="/alerts" icon={Bell} label="Alert rules" hint="Speed, zones, offline" tone="red" />}
            </CardContent>
          </Card>
        </div>
      </div>

      {loadsSection}

      {can("history.read") && (
        <Suspense fallback={<TrendsSkeleton />}>
          <FleetTrends organizationId={ctx.organizationId} u={u} canSeeAlerts={can("alerts.read")} now={now} days={chartDays} />
        </Suspense>
      )}

      {can("history.read") && (
        <Suspense fallback={<TripsSkeleton />}>
          <RecentTrips ctx={ctx} devices={devices} now={now} u={u} />
        </Suspense>
      )}
    </>
  );
}


/** Latest alerts (fleet and load alerts alike), shared by every dashboard. */
function RecentAlertsCard({ alerts, now, timeZone, canWrite, emptyHint }: { alerts: Awaited<ReturnType<typeof listEvents>>; now: Date; timeZone: string; canWrite: boolean; emptyHint: string }) {
  return (
    <Card>
              <CardHeader>
                <IconTitle icon={Bell} tone="red">Recent alerts</IconTitle>
                <Link href="/alerts" className="text-sm text-primary no-underline hover:underline">
                  View all
                </Link>
              </CardHeader>
              {alerts.length === 0 ? (
                <CardContent className="flex flex-col items-center px-6 py-7 text-center">
                  <span className="relative grid size-14 place-items-center rounded-full bg-success-soft text-success">
                    <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-full bg-success/15 [animation-duration:2.6s] motion-reduce:hidden" />
                    <CheckCircle2 className="relative size-7" aria-hidden="true" />
                  </span>
                  <p className="m-0 mt-3 text-base font-semibold text-[#0a2463]">You&apos;re all caught up</p>
                  <p className="m-0 mt-1 max-w-xs text-sm text-muted-foreground">No new alerts. {emptyHint}</p>
                  {canWrite && (
                    <Link href="/alerts" className="mt-3 text-sm font-medium text-primary no-underline hover:underline">
                      Manage alert rules
                    </Link>
                  )}
                </CardContent>
              ) : (
                <ul className="m-0 list-none divide-y divide-border p-0">
                  {alerts.map((a) => {
                    const m = alertMeta(a.type);
                    return (
                      <li key={a.id} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-primary-soft/40 sm:px-5">
                        <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", m.severity === "high" ? "bg-danger-soft text-danger" : m.severity === "medium" ? "bg-warning-soft text-warning" : "bg-info-soft text-info")}>
                          <AlertTriangle className="size-4" aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1 text-sm">
                          <p className="m-0 truncate">
                            <strong className="font-medium">{a.vehicleName ?? (a.ruleName.startsWith("Load ") ? a.ruleName : "A device")}</strong> {m.short}
                          </p>
                          <p className="m-0 truncate text-xs text-muted-foreground">
                            {a.ruleName} · {relativeTime(a.occurredAt, now.getTime(), timeZone)}
                          </p>
                        </div>
                        {!a.acknowledgedAt && <StatusBadge tone="danger" label="New" />}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
  );
}

function rank(s: FleetState) {
  return { moving: 0, idle: 1, stopped: 2, parked: 3, offline: 4, never_seen: 5 }[s];
}

/** Share of the fleet in each status: a ring with the total in the middle, and a labelled legend (no colour-only meaning). */
function StatusDonut({ total, parts }: { total: number; parts: { key: string; label: string; color: string; value: number }[] }) {
  if (total === 0) return null;
  const R = 42;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const arcs = parts
    .filter((p) => p.value > 0)
    .map((p) => {
      const len = (p.value / total) * C;
      const arc = { key: p.key, color: p.color, len, offset };
      offset += len;
      return arc;
    });
  // A small gap between segments, unless one status is the whole ring.
  const gap = arcs.length > 1 ? 2 : 0;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-4 px-5 pb-5">
      <svg viewBox="0 0 100 100" className="size-32 shrink-0 -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={R} fill="none" stroke="var(--color-muted)" strokeWidth="11" />
        {arcs.map((a) => (
          <circle key={a.key} cx="50" cy="50" r={R} fill="none" stroke={a.color} strokeWidth="11" strokeDasharray={`${Math.max(0, a.len - gap)} ${C}`} strokeDashoffset={-a.offset} className="animate-fade" />
        ))}
        <text x="50" y="50" transform="rotate(90 50 50)" textAnchor="middle" dominantBaseline="central" className="fill-foreground text-[22px] font-semibold tabular-nums">
          {total}
        </text>
        <text x="50" y="66" transform="rotate(90 50 50)" textAnchor="middle" className="fill-muted-foreground text-[8px]">
          vehicle{total === 1 ? "" : "s"}
        </text>
      </svg>
      <ul className="m-0 grid min-w-48 flex-1 list-none grid-cols-2 gap-x-4 gap-y-2 p-0 text-sm">
        {parts.map((p) => (
          <li key={p.key}>
            <Link href={`/vehicles?state=${p.key}`} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-foreground no-underline hover:bg-canvas">
              <span aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
              <span className="flex-1 text-muted-foreground">{p.label}</span>
              <strong className="font-semibold tabular-nums">{p.value}</strong>
              <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{Math.round((p.value / total) * 100)}%</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Trips in the last 24 h for the most recently seen devices (bounded work). */
// cache(): the stat card and the list share one computation per request.
const tripsLast24h = cache(async (ctx: TenantContext, devices: CurrentDeviceLocation[], now: Date) => {
  const from = new Date(now.getTime() - 24 * 3600_000);
  const recent = devices
    .filter((d) => d.lastSeenAt && Date.parse(d.lastSeenAt) >= from.getTime())
    .sort((a, b) => Date.parse(b.lastSeenAt!) - Date.parse(a.lastSeenAt!))
    .slice(0, TRIP_SUMMARY_MAX_DEVICES);
  const reports = await Promise.all(recent.map((d) => buildTripReport(ctx.organizationId, d.deviceId, from, now, "UTC").then((r) => ({ d, r }))));
  const trips = reports.flatMap(({ d, r }) => r.trips.map((t) => ({ ...t, vehicle: d.vehicle?.name ?? d.name ?? d.model ?? "Device", deviceId: d.deviceId })));
  return { trips: trips.sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt)), partial: devices.length > TRIP_SUMMARY_MAX_DEVICES, from };
});

async function RecentTrips({ ctx, devices, now, u }: { ctx: TenantContext; devices: CurrentDeviceLocation[]; now: Date; u: Units }) {
  const { trips, partial, from } = await tripsLast24h(ctx, devices, now);
  const km = trips.reduce((a, t) => a + t.distanceKm, 0);
  return (
    <Card className="mt-5">
      <CardHeader>
        <IconTitle
          icon={Route}
          tone="green"
          sub={
            <>
              Last 24 hours · {trips.length} trip{trips.length === 1 ? "" : "s"} · {u.fmtDist(km)}
              {partial ? ` · ${TRIP_SUMMARY_MAX_DEVICES} most recently active vehicles` : ""}
            </>
          }
        >
          Recent trips
        </IconTitle>
        <Link href="/reports" className="text-sm text-primary no-underline hover:underline">
          Trip reports
        </Link>
      </CardHeader>
      {trips.length === 0 ? (
        <CardContent className="text-sm text-muted-foreground">No trips in the last 24 hours.</CardContent>
      ) : (
        <ul className="m-0 list-none divide-y divide-border p-0">
          {trips.slice(0, 6).map((t) => (
            <li key={`${t.deviceId}-${t.startAt}`}>
              <Link
                href={`/map?device=${t.deviceId}&from=${encodeURIComponent(t.startAt)}&to=${encodeURIComponent(new Date(Date.parse(t.endAt) + 60_000).toISOString())}`}
                className="group flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-sm text-foreground no-underline transition-colors hover:bg-primary-soft/40 sm:px-5"
              >
                <span className="flex min-w-40 flex-1 items-center gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-success-soft text-success">
                    <Route className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{t.vehicle}</span>
                    <LocalTime iso={t.startAt} className="block text-xs text-muted-foreground" />
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5 text-xs font-medium tabular-nums">
                  <span className="rounded-full bg-primary-soft px-2.5 py-1 text-primary">{u.fmtDist(t.distanceKm)}</span>
                  <span className="rounded-full bg-muted px-2.5 py-1 text-foreground">{durationMin(t.durationMin)}</span>
                  <span className="rounded-full bg-muted px-2.5 py-1 text-foreground">max {u.fmtSpeed(t.maxSpeedKph)}</span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <span className="sr-only">Trips since {from.toISOString()}</span>
    </Card>
  );
}

function TripsSkeleton() {
  return (
    <Card className="mt-5" aria-busy="true">
      <CardHeader>
        <CardTitle>Recent trips</CardTitle>
      </CardHeader>
      <div className="grid gap-3 p-5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    </Card>
  );
}
