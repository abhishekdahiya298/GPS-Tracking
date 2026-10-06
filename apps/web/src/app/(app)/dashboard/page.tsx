import { contextHasPermission, units, type TenantContext, type Units } from "@rio-gps/core";
import { Activity, AlertTriangle, CalendarClock, ArrowRight, Bell, Car, CircleOff, CircleParking, Hexagon, Map as MapIcon, MapPin, Plus, Route, Truck, Wrench } from "lucide-react";
import Link from "next/link";
import { VehicleTypeIcon } from "@/components/app/vehicle-type-icon";
import { redirect } from "next/navigation";
import { cache, Suspense, type ReactNode } from "react";
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
import { FleetTrends, TrendsSkeleton } from "./fleet-trends";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard · RIO GPS" };

/** Trip summary covers the vehicles most recently seen, to keep the page fast on big fleets. */
const TRIP_SUMMARY_MAX_DEVICES = 25;

export default async function DashboardPage() {
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

  const actions = (
    <>
      {can("locations.read") && (
        <Button asChild>
          <Link href="/map">
            <MapIcon aria-hidden="true" /> Live map
          </Link>
        </Button>
      )}
    </>
  );

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
      <PageHeader title="Fleet overview" description="What's happening with your fleet right now." actions={actions} />

      <section aria-label="Fleet summary" className="stagger-in mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
        <Stat label="Vehicles" value={devices.length} icon={Truck} href="/vehicles" className="col-span-2 2xl:col-span-1" />
        <Stat label="Moving" value={count("moving")} icon={Car} tone="success" href="/vehicles?state=moving" />
        <Stat label="Idling" value={count("idle")} icon={Activity} tone={count("idle") > 0 ? "warning" : undefined} hint="engine on" href="/vehicles?state=idle" />
        <Stat label="Stopped" value={count("stopped")} icon={CircleParking} tone="info" href="/vehicles?state=stopped" />
        <Stat label="Offline" value={count("offline") + count("never_seen")} icon={CircleOff} href="/vehicles?state=offline" />
        {can("alerts.read") && <Stat label="Unread alerts" value={unack} icon={Bell} tone={unack > 0 ? "danger" : undefined} href="/alerts" />}
        {can("history.read") && (
          <Suspense fallback={<StatSkeleton label="Trips · 24 h" />}>
            <TripsStat ctx={ctx} devices={devices} now={now} />
          </Suspense>
        )}
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

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <Card className="min-w-0 lg:col-span-3">
          <CardHeader>
            <CardTitle>Fleet status</CardTitle>
            <Link href="/vehicles" className="text-sm text-primary no-underline hover:underline">
              All vehicles
            </Link>
          </CardHeader>
          <StatusBar
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
                        {d.location ? `${u.fmtSpeed(d.location.speedKph)} · ignition ${d.location.ignition === true ? "on" : d.location.ignition === false ? "off" : "unknown"} · ` : ""}
                        seen {relativeTime(d.lastSeenAt, now.getTime(), rc.timeZone)}
                      </span>
                    </span>
                    <StatusBadge tone={FLEET_STATE_META[s].tone} label={FLEET_STATE_META[s].label} pulse={s === "moving"} />
                  </Link>
                </li>
              ))}
          </ul>
          {devices.length > 8 && <p className="m-0 border-t border-border px-5 py-2.5 text-xs text-muted-foreground">Showing 8 of {devices.length}. Moving and idle vehicles first.</p>}
        </Card>

        <div className="grid min-w-0 grid-cols-1 content-start gap-5 lg:col-span-2">
          {can("alerts.read") && (
            <Card>
              <CardHeader>
                <CardTitle>Recent alerts</CardTitle>
                <Link href="/alerts" className="text-sm text-primary no-underline hover:underline">
                  View all
                </Link>
              </CardHeader>
              {recentAlerts.length === 0 ? (
                <CardContent className="text-sm text-muted-foreground">No alerts yet. Set up speeding, zone and offline alerts to be notified.</CardContent>
              ) : (
                <ul className="m-0 list-none divide-y divide-border p-0">
                  {recentAlerts.map((a) => {
                    const m = alertMeta(a.type);
                    return (
                      <li key={a.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                        <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", m.severity === "high" ? "text-danger" : m.severity === "medium" ? "text-warning" : "text-info")} aria-hidden="true" />
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
              <CardTitle>Quick actions</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              {can("locations.read") && <QuickAction href="/map" icon={MapIcon} label="Live map" />}
              {can("vehicles.create") && <QuickAction href="/vehicles" icon={Plus} label="Add vehicle" />}
              {can("geofences.write") && <QuickAction href="/geofences" icon={Hexagon} label="Create zone" />}
              {can("history.read") && <QuickAction href="/reports" icon={Route} label="Trip reports" />}
              {can("alerts.write") && <QuickAction href="/alerts" icon={Bell} label="Alert rules" />}
              {ctx.isSuperAdmin && <QuickAction href="/admin/customers" icon={MapPin} label="Add device" />}
            </CardContent>
          </Card>
        </div>
      </div>

      {can("history.read") && (
        <Suspense fallback={<TrendsSkeleton />}>
          <FleetTrends organizationId={ctx.organizationId} u={u} canSeeAlerts={can("alerts.read")} now={now} />
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

/** Share of the fleet in each status: one proportional bar with a labelled legend (no colour-only meaning). */
function StatusBar({ total, parts }: { total: number; parts: { key: string; label: string; color: string; value: number }[] }) {
  if (total === 0) return null;
  return (
    <div className="px-5 pb-4">
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <span key={p.key} className="origin-left animate-grow-x" style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
          ))}
      </div>
      <ul className="m-0 mt-3 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 text-xs text-muted-foreground">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block size-2 rounded-full" style={{ background: p.color }} />
            <Link href={`/vehicles?state=${p.key}`} className="text-inherit no-underline hover:underline">
              {p.label} <strong className="font-semibold tabular-nums text-foreground">{p.value}</strong>{" "}
              <span className="tabular-nums">({Math.round((p.value / total) * 100)}%)</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, value, icon: Icon, tone, hint, href, className }: { label: string; value: ReactNode; icon: typeof Truck; tone?: "success" | "danger" | "warning" | "info" | "neutral"; hint?: string; href?: string; className?: string }) {
  const body = (
    <Card className={cn("h-full p-4", href && "transition-colors hover:border-primary/40")}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Icon className={cn("size-4", tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : tone === "info" ? "text-info" : "text-muted-foreground")} aria-hidden="true" />
      </div>
      <p className="m-0 mt-2 text-2xl font-semibold tabular-nums text-foreground">
        {value}
        {hint && <span className="ml-1 text-sm font-normal text-muted-foreground">{hint}</span>}
      </p>
    </Card>
  );
  return href ? (
    <Link href={href} className={cn("block text-inherit no-underline", className)}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function StatSkeleton({ label }: { label: string }) {
  return (
    <Card className="p-4" aria-busy="true">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Skeleton className="mt-3 h-6 w-12" />
    </Card>
  );
}

function QuickAction({ href, icon: Icon, label }: { href: string; icon: typeof Truck; label: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5 text-sm font-medium text-foreground no-underline hover:bg-canvas">
      <Icon className="size-4 text-primary" aria-hidden="true" />
      <span className="truncate">{label}</span>
      <ArrowRight className="ml-auto size-3.5 text-muted-foreground" aria-hidden="true" />
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

async function TripsStat({ ctx, devices, now }: { ctx: TenantContext; devices: CurrentDeviceLocation[]; now: Date }) {
  const { trips } = await tripsLast24h(ctx, devices, now);
  return <Stat label="Trips · 24 h" value={trips.length} icon={Route} href="/reports" />;
}

async function RecentTrips({ ctx, devices, now, u }: { ctx: TenantContext; devices: CurrentDeviceLocation[]; now: Date; u: Units }) {
  const { trips, partial, from } = await tripsLast24h(ctx, devices, now);
  const km = trips.reduce((a, t) => a + t.distanceKm, 0);
  return (
    <Card className="mt-5">
      <CardHeader>
        <div>
          <CardTitle>Recent trips</CardTitle>
          <p className="m-0 text-sm text-muted-foreground">
            Last 24 hours · {trips.length} trip{trips.length === 1 ? "" : "s"} · {u.fmtDist(km)}
            {partial ? ` · ${TRIP_SUMMARY_MAX_DEVICES} most recently active vehicles` : ""}
          </p>
        </div>
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
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm text-foreground no-underline hover:bg-canvas sm:px-5"
              >
                <span className="min-w-32 flex-1 font-medium">{t.vehicle}</span>
                <LocalTime iso={t.startAt} className="text-muted-foreground" />
                <span className="tabular-nums">{u.fmtDist(t.distanceKm)}</span>
                <span className="tabular-nums text-muted-foreground">{durationMin(t.durationMin)}</span>
                <span className="tabular-nums text-muted-foreground">max {u.fmtSpeed(t.maxSpeedKph)}</span>
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
