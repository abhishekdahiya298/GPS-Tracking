import { contextHasPermission, units, type TenantContext, type Units } from "@rio-gps/core";
import { Activity, AlertTriangle, ArrowRight, Bell, Car, CircleOff, Hexagon, Map as MapIcon, MapPin, Plus, Route, Truck, Wrench } from "lucide-react";
import Link from "next/link";
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
import { buildTripReport } from "@/lib/reports";
import { getRequestContext, getUnacknowledgedAlertCount } from "@/lib/request-context";

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

  const [devices, unack, maint, recentAlerts] = await Promise.all([
    can("locations.read") ? listCurrentLocations(ctx.organizationId, now, getServerEnv().GPS_DEVICE_OFFLINE_THRESHOLD_SECONDS) : Promise.resolve([] as CurrentDeviceLocation[]),
    can("alerts.read") ? getUnacknowledgedAlertCount(ctx.organizationId) : Promise.resolve(0),
    can("maintenance.read") ? dueCounts(ctx.organizationId, now) : Promise.resolve(null),
    can("alerts.read") ? listEvents(ctx.organizationId, { limit: 5, unacknowledgedOnly: false }) : Promise.resolve([])
  ]);

  const states = devices.map((d) => ({ d, s: fleetState(d) }));
  const count = (s: FleetState) => states.filter((x) => x.s === s).length;
  const online = count("moving") + count("idle");
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

      <section aria-label="Fleet summary" className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Vehicles" value={devices.length} icon={Truck} href="/vehicles" />
        <Stat label="Online" value={online} icon={Activity} tone="success" hint={`of ${devices.length}`} />
        <Stat label="Moving" value={count("moving")} icon={Car} tone="success" href="/map" />
        <Stat label="Offline" value={count("offline") + count("never_seen")} icon={CircleOff} tone={count("offline") > 0 ? "neutral" : undefined} />
        {can("alerts.read") && <Stat label="Unread alerts" value={unack} icon={Bell} tone={unack > 0 ? "danger" : undefined} href="/alerts" />}
        {can("history.read") && (
          <Suspense fallback={<StatSkeleton label="Trips · 24 h" />}>
            <TripsStat ctx={ctx} devices={devices} now={now} />
          </Suspense>
        )}
      </section>

      {maint && maint.overdue > 0 && (
        <Link href="/maintenance" className="mb-5 flex items-center gap-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-foreground no-underline hover:border-danger/50">
          <Wrench className="size-4 shrink-0 text-danger" aria-hidden="true" />
          <span className="flex-1">
            <strong>{maint.overdue}</strong> maintenance item{maint.overdue === 1 ? " is" : "s are"} overdue{maint.dueSoon ? `, ${maint.dueSoon} due soon` : ""}.
          </span>
          <span className="font-medium text-danger">Review</span>
        </Link>
      )}

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Fleet status</CardTitle>
            <Link href="/vehicles" className="text-sm text-primary no-underline hover:underline">
              All vehicles
            </Link>
          </CardHeader>
          <ul className="m-0 list-none divide-y divide-border p-0">
            {states
              .sort((a, b) => rank(a.s) - rank(b.s))
              .slice(0, 8)
              .map(({ d, s }) => (
                <li key={d.deviceId}>
                  <Link href={`/map?focus=${d.deviceId}`} className="flex items-center gap-3 px-4 py-3 text-foreground no-underline hover:bg-canvas sm:px-5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                      <Truck className="size-4 text-muted-foreground" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{d.vehicle?.name ?? d.name ?? d.model ?? "Device"}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {d.location ? `${u.fmtSpeed(d.location.speedKph)} · ignition ${d.location.ignition === true ? "on" : d.location.ignition === false ? "off" : "unknown"} · ` : ""}
                        seen {relativeTime(d.lastSeenAt, now.getTime())}
                      </span>
                    </span>
                    <StatusBadge tone={FLEET_STATE_META[s].tone} label={FLEET_STATE_META[s].label} pulse={s === "moving"} />
                  </Link>
                </li>
              ))}
          </ul>
          {devices.length > 8 && <p className="m-0 border-t border-border px-5 py-2.5 text-xs text-muted-foreground">Showing 8 of {devices.length}. Moving and idle vehicles first.</p>}
        </Card>

        <div className="grid content-start gap-5 lg:col-span-2">
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
                            {a.ruleName} · {relativeTime(a.occurredAt, now.getTime())}
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
        <Suspense fallback={<TripsSkeleton />}>
          <RecentTrips ctx={ctx} devices={devices} now={now} u={u} />
        </Suspense>
      )}
    </>
  );
}

function rank(s: FleetState) {
  return { moving: 0, idle: 1, offline: 2, never_seen: 3 }[s];
}

function Stat({ label, value, icon: Icon, tone, hint, href }: { label: string; value: ReactNode; icon: typeof Truck; tone?: "success" | "danger" | "neutral"; hint?: string; href?: string }) {
  const body = (
    <Card className={cn("h-full p-4", href && "transition-colors hover:border-primary/40")}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Icon className={cn("size-4", tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-muted-foreground")} aria-hidden="true" />
      </div>
      <p className="m-0 mt-2 text-2xl font-semibold tabular-nums text-foreground">
        {value}
        {hint && <span className="ml-1 text-sm font-normal text-muted-foreground">{hint}</span>}
      </p>
    </Card>
  );
  return href ? (
    <Link href={href} className="block text-inherit no-underline">
      {body}
    </Link>
  ) : (
    body
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
