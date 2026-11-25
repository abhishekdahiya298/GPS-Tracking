import { contextHasPermission, type TenantContext } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { CheckCircle2, Circle, Map as MapIcon, MapPin, Navigation, Package, Plus, Radio, Smartphone, Truck, UserPlus, Users, Zap } from "lucide-react";
import Link from "next/link";
import { IconTitle } from "@/components/app/icon-title";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { organizationPlanAccess } from "@/lib/plans";
import { organizationUsage } from "@/lib/entitlements";
import { storeLinks } from "@/lib/app-releases";
import { cn } from "@/lib/cn";
import type { LoadDashboard } from "@/lib/load-dashboard";
import { FleetGlance } from "./fleet-glance";
import { Hero, QuickAction, Tile } from "./parts";
import { NotInPlanCard } from "./plan-cards";

/**
 * The dashboard for a new company (and for plans without GPS trackers, like Free Basic): the same
 * layout as the full Dashboard (status tiles, the big live map, cards beside and below it), with a
 * "Get started" checklist, what the plan doesn't include and who is driving.
 */
export async function StarterDashboard({
  ctx,
  hello,
  orgName,
  dateLabel,
  vehiclesOnMap,
  movingNow,
  offlineSeconds,
  loads
}: {
  ctx: TenantContext;
  hello: string;
  orgName: string;
  dateLabel: string;
  vehiclesOnMap: number;
  movingNow: number;
  offlineSeconds: number;
  loads: LoadDashboard | null;
}) {
  const can = (p: Parameters<typeof contextHasPermission>[1]) => contextHasPermission(ctx, p);
  const db = getDb();
  const [usage, access, [ever], drivers, [app], stores] = await Promise.all([
    organizationUsage(ctx.organizationId),
    organizationPlanAccess(ctx.organizationId),
    db.execute<{ loads: number }>(sql`select count(*)::int as loads from loads where organization_id = ${ctx.organizationId}`),
    can("vehicles.read")
      ? db
          .select({ id: schema.drivers.id, name: schema.drivers.name, phone: schema.drivers.phone, vehicle: schema.vehicles.name })
          .from(schema.drivers)
          .leftJoin(schema.vehicles, eq(schema.vehicles.id, schema.drivers.vehicleId))
          .where(and(eq(schema.drivers.organizationId, ctx.organizationId), eq(schema.drivers.status, "active")))
          .orderBy(asc(schema.drivers.name))
          .limit(4)
      : Promise.resolve([]),
    db.execute<{ n: number }>(sql`select count(*)::int as n from push_devices where organization_id = ${ctx.organizationId}`),
    storeLinks()
  ]);
  const limits = access?.limits ?? {};
  const of = (n: number | undefined, noun: string) => (n === undefined ? noun : `of ${n} on your plan`);
  // A driver "shares" while their load link is live (the driver app adds phones that share all the time).
  const sharing = loads ? Math.max(0, loads.active - loads.counts.waiting - loads.attention.filter((a) => a.reason !== "late").length) : 0;

  const steps = [
    { done: usage.vehicles > 0, label: "Add your first truck", hint: "Name, plate and VIN", href: "/vehicles?new=1", cta: "Add truck", show: can("vehicles.create") },
    { done: usage.drivers > 0, label: "Invite your drivers", hint: "They join in the RIO GPS app with your code", href: "/drivers?invite=1", cta: "Invite", show: can("vehicles.create") },
    { done: (ever?.loads ?? 0) > 0, label: "Create your first load", hint: "Pickup, delivery and appointment", href: "/loads/new", cta: "Create load", show: can("loads.write") },
    { done: (app?.n ?? 0) > 0, label: "Get the mobile app", hint: "See your trucks from your phone", href: stores.ios, cta: "Get the app", show: true }
  ].filter((s) => s.show);
  const done = steps.filter((s) => s.done).length;

  return (
    <>
      <Hero greeting={hello} orgName={orgName} dateLabel={dateLabel} summary={`${access?.planName ?? "Your plan"} · ${usage.vehicles} truck${usage.vehicles === 1 ? "" : "s"} · ${usage.loadsPerMonth} load${usage.loadsPerMonth === 1 ? "" : "s"} this month`} action={can("locations.read") ? { href: "/map", label: "Open live map" } : undefined} />

      <section aria-label="Your fleet at a glance" className="stagger-in mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Tile label="Trucks" value={usage.vehicles} icon={Truck} look="total" hint={of(limits.vehicles, "Your fleet")} href="/vehicles" className="col-span-2 md:col-span-1" />
        <Tile label="Drivers" value={usage.drivers} icon={Users} look="calm" hint={of(limits.drivers, "Active drivers")} href="/drivers" />
        <Tile label="Loads this month" value={usage.loadsPerMonth} icon={Package} look="pickup" hint={of(limits.loadsPerMonth, "Created this month")} href="/loads" />
        <Tile label="Moving now" value={movingNow} icon={Navigation} look="moving" hint={movingNow ? "On the road" : "Nothing moving"} href="/map" />
        <Tile label="Drivers sharing" value={sharing} icon={MapPin} look="offline" hint={sharing ? "Location from their phone" : "No one sharing now"} href="/drivers" />
      </section>

      <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {can("locations.read") &&
          (vehiclesOnMap > 0 ? (
            <FleetGlance offlineSeconds={offlineSeconds} className="flex min-w-0 flex-col overflow-hidden md:col-span-2 xl:row-span-2" mapClassName="h-[320px] xl:h-auto xl:min-h-[460px] xl:flex-1" />
          ) : (
            <Card className="relative flex min-h-[320px] min-w-0 flex-col overflow-hidden md:col-span-2 xl:row-span-2">
              <CardHeader>
                <IconTitle icon={Radio}>Your fleet, live</IconTitle>
                <Link href="/map" className="text-sm text-primary no-underline hover:underline">
                  Full screen
                </Link>
              </CardHeader>
              <div className="relative flex-1 overflow-hidden bg-[#e9efe9] dark:bg-muted">
                <div aria-hidden="true" className="absolute -left-[6%] top-[6%] h-[52%] w-[44%] rounded-[46%_54%_40%_60%] bg-[#b9d3ee] dark:bg-white/5" />
                <div aria-hidden="true" className="absolute inset-x-0 top-[62%] h-[7px] -rotate-[8deg] bg-[#f6c96b] dark:bg-white/10" />
                <div aria-hidden="true" className="absolute inset-y-0 left-[58%] w-[5px] rotate-[18deg] bg-[#f6c96b] dark:bg-white/10" />
                <div className="absolute inset-0 grid place-items-center p-6">
                  <div className="max-w-sm rounded-2xl bg-background/95 p-5 text-center shadow-pop">
                    <MapIcon className="mx-auto size-8 text-primary" aria-hidden="true" />
                    <p className="m-0 mt-2 font-semibold text-[#0a2463] dark:text-foreground">Your trucks show up here</p>
                    <p className="m-0 mt-1 text-sm text-muted-foreground">Add a truck and invite its driver. The driver&apos;s phone puts the truck on the map.</p>
                    <div className="mt-3 flex flex-wrap justify-center gap-2">
                      {can("vehicles.create") && (
                        <Button asChild size="sm">
                          <Link href="/drivers?invite=1">
                            <UserPlus /> Invite a driver
                          </Link>
                        </Button>
                      )}
                      {can("vehicles.create") && (
                        <Button asChild size="sm" variant="secondary">
                          <Link href="/vehicles?new=1">
                            <Plus /> Add truck
                          </Link>
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          ))}

        <Card className="min-w-0">
          <CardHeader>
            <IconTitle icon={CheckCircle2} tone="green">
              Get started
            </IconTitle>
            <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">
              {done} of {steps.length} done
            </span>
          </CardHeader>
          <div className="px-4 pb-1 sm:px-5" aria-hidden="true">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-success" style={{ width: `${steps.length ? (done / steps.length) * 100 : 0}%` }} />
            </div>
          </div>
          <ul className="m-0 mt-2 list-none divide-y divide-border p-0">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                {s.done ? <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden="true" /> : <Circle className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                <span className="min-w-0 flex-1">
                  <b className={cn("block truncate text-sm", s.done && "text-muted-foreground line-through")}>{s.label}</b>
                  <span className="block truncate text-xs text-muted-foreground">{s.hint}</span>
                </span>
                {!s.done && (
                  <Button asChild size="sm" variant="secondary">
                    <Link href={s.href}>{s.cta}</Link>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <NotInPlanCard />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <IconTitle icon={Zap}>Quick actions</IconTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-2.5">
            {can("locations.read") && <QuickAction href="/map" icon={MapIcon} label="Live map" hint="Every truck now" tone="navy" />}
            {can("vehicles.create") && <QuickAction href="/vehicles?new=1" icon={Plus} label="Add truck" hint="Truck, trailer or asset" tone="green" />}
            {can("vehicles.create") && <QuickAction href="/drivers?invite=1" icon={UserPlus} label="Invite driver" hint="Join with your code" tone="purple" />}
            {can("loads.write") && <QuickAction href="/loads/new" icon={Package} label="New load" hint="Track a shipment" tone="red" />}
            {can("vehicles.read") && <QuickAction href="/drivers" icon={Users} label="Drivers" hint="Who drives what" tone="amber" />}
            <QuickAction href={stores.ios} icon={Smartphone} label="iPhone app" hint="Download from the App Store" tone="navy" />
          </CardContent>
        </Card>
        {can("vehicles.read") && (
          <Card className="min-w-0">
            <CardHeader>
              <IconTitle icon={Users} tone="blue">
                Your drivers
              </IconTitle>
              {limits.drivers !== undefined && (
                <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">
                  {usage.drivers} of {limits.drivers}
                </span>
              )}
            </CardHeader>
            <CardContent className="grid gap-2">
              {drivers.length === 0 ? (
                <p className="m-0 text-sm text-muted-foreground">No drivers yet. Invite them and they join in the RIO GPS app with your company code.</p>
              ) : (
                <ul className="m-0 grid list-none gap-2 p-0">
                  {drivers.map((d) => (
                    <li key={d.id}>
                      <Link href={`/drivers?search=${encodeURIComponent(d.name)}`} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2 text-foreground no-underline hover:border-primary/40">
                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#1d4ed8,#0a2463)] text-xs font-bold text-white">
                          {d.name
                            .split(/\s+/)
                            .map((w) => w[0])
                            .slice(0, 2)
                            .join("")
                            .toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <b className="block truncate text-sm">{d.name}</b>
                          <span className="block truncate text-xs text-muted-foreground">{d.vehicle ?? "No truck yet"}{d.phone ? ` · ${d.phone}` : ""}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {can("vehicles.create") && (
                <Button asChild className="mt-1">
                  <Link href="/drivers?invite=1">
                    <UserPlus /> Invite a driver
                  </Link>
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
