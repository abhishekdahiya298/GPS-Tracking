import { contextHasPermission, units, type TenantContext, type Units } from "@rio-gps/core";
import { Activity, AlertTriangle, PieChart, Zap, CheckCircle2, CalendarClock, ArrowRight, Bell, CircleOff, CircleParking, Hexagon, Map as MapIcon, Navigation, Plus, Route, Truck, Wrench } from "lucide-react";
import Link from "next/link";
import { CHART_RANGES, type ChartRange } from "@/lib/daily-stats";
import { VehicleTypeIcon } from "@/components/app/vehicle-type-icon";
import { redirect } from "next/navigation";
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
import { getRequestContext, getUnacknowledgedAlertCount } from "@/lib/request-context";
import { FleetGlance } from "./fleet-glance";
import { FleetTrends, TrendsSkeleton } from "./fleet-trends";
import { IconTitle } from "@/components/app/icon-title";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard · RIO Tracking" };

/** Trip summary covers the vehicles most recently seen, to keep the page fast on big fleets. */
const TRIP_SUMMARY_MAX_DEVICES = 25;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const rangeParam = Number((await searchParams).range);
  const chartDays: ChartRange = (CHART_RANGES as readonly number[]).includes(rangeParam) ? (rangeParam as ChartRange) : 30;
  const rc = await getRequestContext();
  if (rc.status !== "ok") redirect("/login?next=/dashboard");
  const { ctx, user, unitSystem } = rc;
  const u = units(unitSystem);
  const now = new Date();
  const can = (p: Parameters<typeof contextHasPermission>[1]) => contextHasPermission(ctx, p);

  const [devices, unack, maint, renewals, recentAlerts] = await Promise.all([
    can("locations.read") ? listCurrentLocations(ctx.organizationId, now, getServerEnv().GPS_DEVICE_OFFLINE_THRESHOLD_SECONDS) : Promise.resolve([] as CurrentDeviceLocation[]),
    can("alerts.read") ? getUnacknowledgedAlertCount(ctx.organizationId) : Promise.resolve(0),
    can("maintenance.read") ? dueCounts(ctx.organizationId, now) : Promise.resolve(null),
    can("maintenance.read") ? renewalCounts(ctx.organizationId, now) : Promise.resolve(null),
    can("alerts.read") ? listEvents(ctx.organizationId, { limit: 5, unacknowledgedOnly: false }) : Promise.resolve([])
  ]);

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
      </>
    );
  }

  return (
    <>
      <Hero
        greeting={`${greeting(now, rc.timeZone)}${firstName ? `, ${firstName}` : ""}`}
        orgName={rc.orgName}
        dateLabel={new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: rc.timeZone }).format(now)}
        summary={`${count("moving")} of ${devices.length} vehicle${devices.length === 1 ? "" : "s"} on the road${unack > 0 ? ` · ${unack} unread alert${unack === 1 ? "" : "s"}` : ""}`}
        showMap={can("locations.read")}
      />

      <section aria-label="Fleet summary" className={cn("stagger-in mb-5 grid grid-cols-2 gap-3", tileCount === 5 ? "md:grid-cols-5" : "md:grid-cols-4")}>
        <Tile label="Moving" value={count("moving")} total={devices.length} icon={Navigation} look="moving" href="/vehicles?state=moving" />
        <Tile label="Idling" value={count("idle")} total={devices.length} icon={Activity} look="idle" hint="engine on" href="/vehicles?state=idle" />
        <Tile label="Stopped" value={count("stopped")} total={devices.length} icon={CircleParking} look="stopped" href="/vehicles?state=stopped" />
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
              value: k === "offline" ? count("offline") + count("never_seen") : count(k)
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
          {can("alerts.read") && (
            <Card>
              <CardHeader>
                <IconTitle icon={Bell} tone="red">Recent alerts</IconTitle>
                <Link href="/alerts" className="text-sm text-primary no-underline hover:underline">
                  View all
                </Link>
              </CardHeader>
              {recentAlerts.length === 0 ? (
                <CardContent className="flex items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-success-soft text-success">
                    <CheckCircle2 className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 text-sm">
                    <p className="m-0 font-medium">You&apos;re all caught up</p>
                    <p className="m-0 text-muted-foreground">No alerts right now. Speeding, zone and offline alerts appear here.</p>
                  </div>
                </CardContent>
              ) : (
                <ul className="m-0 list-none divide-y divide-border p-0">
                  {recentAlerts.map((a) => {
                    const m = alertMeta(a.type);
                    return (
                      <li key={a.id} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-primary-soft/40 sm:px-5">
                        <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", m.severity === "high" ? "bg-danger-soft text-danger" : m.severity === "medium" ? "bg-warning-soft text-warning" : "bg-info-soft text-info")}>
                          <AlertTriangle className="size-4" aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1 text-sm">
                          <p className="m-0 truncate">
                            <strong className="font-medium">{a.vehicleName ?? "A device"}</strong> {m.short}
                          </p>
                          <p className="m-0 truncate text-xs text-muted-foreground">
                            {a.ruleName} · {relativeTime(a.occurredAt, now.getTime(), rc.timeZone)}
                          </p>
                        </div>
                        {!a.acknowledgedAt && <StatusBadge tone="danger" label="New" />}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          )}

          <Card>
            <CardHeader>
              <IconTitle icon={Zap}>Quick actions</IconTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              {can("locations.read") && <QuickAction href="/map" icon={MapIcon} label="Live map" />}
              {can("vehicles.create") && <QuickAction href="/vehicles" icon={Plus} label="Add vehicle" />}
              {can("geofences.write") && <QuickAction href="/geofences" icon={Hexagon} label="Create zone" />}
              {can("history.read") && <QuickAction href="/reports" icon={Route} label="Trip reports" />}
              {can("alerts.write") && !can("vehicles.create") && <QuickAction href="/alerts" icon={Bell} label="Alert rules" />}
            </CardContent>
          </Card>
        </div>
      </div>

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

function rank(s: FleetState) {
  return { moving: 0, idle: 1, stopped: 2, offline: 3, never_seen: 4 }[s];
}

/** "Good morning" by the clock in the viewer's time zone. */
function greeting(now: Date, timeZone: string): string {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(now));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** Page banner in the brand colours: navy field, red and white stripes echoing the logo. */
function Hero({ greeting, orgName, dateLabel, summary, showMap }: { greeting: string; orgName: string; dateLabel: string; summary: string; showMap: boolean }) {
  return (
    <header className="relative mb-5 overflow-hidden rounded-xl bg-[linear-gradient(120deg,#0a2463_0%,#12357f_55%,#1d4fb8_100%)] px-5 py-5 text-white shadow-card sm:px-7 sm:py-6">
      <svg aria-hidden="true" viewBox="0 0 400 160" preserveAspectRatio="xMaxYMid slice" className="pointer-events-none absolute inset-y-0 right-0 hidden h-full w-1/2 sm:block">
        <path d="M150 160 230 0h34l-80 160z" fill="#ffffff" opacity="0.07" />
        <path d="M214 160 294 0h22l-80 160z" fill="#d81e2c" opacity="0.85" />
        <path d="M258 160 338 0h34l-80 160z" fill="#ffffff" opacity="0.1" />
        <path d="M322 160 402 0h60v160z" fill="#ffffff" opacity="0.05" />
      </svg>
      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-medium text-white/75">
            {dateLabel} · {orgName}
          </p>
          <h1 className="m-0 mt-1 text-2xl font-semibold tracking-tight sm:text-[28px] sm:leading-9">{greeting}</h1>
          <p className="m-0 mt-1.5 text-sm text-white/85">{summary}</p>
        </div>
        {showMap && (
          <Link href="/map" className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-[#0a2463] no-underline shadow-card transition-transform duration-150 hover:bg-white/90 active:scale-[0.97]">
            <MapIcon className="size-4" aria-hidden="true" /> Open live map
          </Link>
        )}
      </div>
    </header>
  );
}

/** Solid colour per status. Every pair is white text on a background of at least 4.5:1 contrast. */
const TILE_LOOK = {
  moving: "bg-[linear-gradient(135deg,#15803d,#166534)]",
  idle: "bg-[linear-gradient(135deg,#b45309,#92400e)]",
  stopped: "bg-[linear-gradient(135deg,#0369a1,#075985)]",
  offline: "bg-[linear-gradient(135deg,#526079,#3b4558)]",
  alert: "bg-[linear-gradient(135deg,#c81e2b,#991b1b)]",
  calm: "bg-[linear-gradient(135deg,#0a2463,#12357f)]"
} as const;

function Tile({ label, value, total, icon: Icon, look, hint, href, className }: { label: string; value: number; total?: number; icon: typeof Truck; look: keyof typeof TILE_LOOK; hint?: string; href: string; className?: string }) {
  const pct = total ? Math.round((value / total) * 100) : null;
  return (
    <Link
      href={href}
      className={cn("group relative block overflow-hidden rounded-xl p-4 text-white no-underline shadow-card transition-transform duration-150 hover:-translate-y-0.5 focus-visible:outline-offset-2", TILE_LOOK[look], className)}
    >
      <Icon aria-hidden="true" className="pointer-events-none absolute -bottom-3 -right-2 size-20 text-white/15 transition-transform duration-300 group-hover:scale-110" strokeWidth={1.5} />
      <p className="m-0 text-xs font-semibold uppercase tracking-wide text-white/85">{label}</p>
      <p className="m-0 mt-1.5 text-[34px] font-semibold leading-10 tabular-nums">{value}</p>
      <p className="m-0 mt-1 min-h-4 text-xs text-white/85">{pct !== null ? `${pct}% of fleet${hint ? ` · ${hint}` : ""}` : value === 0 ? "All caught up" : "Need a look"}</p>
      {pct !== null && (
        <span aria-hidden="true" className="relative mt-2.5 block h-1 overflow-hidden rounded-full bg-white/25">
          <span className="block h-full origin-left animate-grow-x rounded-full bg-white" style={{ width: `${pct}%` }} />
        </span>
      )}
    </Link>
  );
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

function QuickAction({ href, icon: Icon, label }: { href: string; icon: typeof Truck; label: string }) {
  return (
    <Link href={href} className="group flex items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-foreground no-underline transition-colors hover:border-primary/40 hover:bg-primary-soft">
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary-soft text-primary group-hover:bg-background">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="truncate">{label}</span>
      <ArrowRight className="ml-auto size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
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
