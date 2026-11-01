import { dateFormatter, type TimeFormat } from "@rio-gps/core/timezones";
import { AlarmClock, ArrowRight, CalendarClock, CheckCircle2, CircleDot, Clock, Hourglass, Navigation, PackageCheck, PauseCircle, Siren, WifiOff, Truck } from "lucide-react";
import Link from "next/link";
import { ColumnChart } from "@/components/app/charts";
import { IconTitle } from "@/components/app/icon-title";
import { UsageMeter } from "@/components/app/usage-meter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { LoadAttentionReason, LoadDashboard } from "@/lib/load-dashboard";
import { shortPlace } from "@/lib/load-meta";
import type { LoadAllowance } from "@/lib/plans";
import { Tile } from "./parts";

/**
 * Loads panels for the dashboard. A Loads-only plan gets all of them as its home page; a
 * GPS + Loads plan gets the tiles and the attention list next to its fleet overview. Same
 * components, same rules as the Loads list (late, no signal, paused), so numbers always agree.
 */

export function LoadTiles({ d }: { d: LoadDashboard }) {
  const n = d.active;
  return (
    <section aria-label="Loads summary" className="stagger-in grid grid-cols-2 gap-3 md:grid-cols-5">
      <Tile label="Waiting for driver" value={d.counts.waiting} total={n} totalNoun="active loads" icon={Hourglass} look="waiting" href="/loads?filter=active" />
      <Tile label="To pickup" value={d.counts.toPickup} total={n} totalNoun="active loads" icon={CircleDot} look="pickup" href="/loads?filter=active" />
      <Tile label="In transit" value={d.counts.inTransit} total={n} totalNoun="active loads" icon={Navigation} look="moving" href="/loads?filter=active" />
      <Tile label="At delivery" value={d.counts.atDelivery} total={n} totalNoun="active loads" icon={PackageCheck} look="stopped" href="/loads?filter=active" />
      <Tile label="Need attention" value={d.counts.attention} icon={Siren} look={d.counts.attention > 0 ? "alert" : "calm"} href="/loads/map" className="col-span-2 md:col-span-1" />
    </section>
  );
}

const REASON: Record<LoadAttentionReason, { label: (m: number | null) => string; icon: typeof Truck; cls: string }> = {
  late: { label: (m) => (m && m > 0 ? `Late by ${m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m} min`}` : "Running late"), icon: AlarmClock, cls: "bg-danger-soft text-danger" },
  no_signal: { label: () => "No recent location", icon: WifiOff, cls: "bg-warning-soft text-warning" },
  paused: { label: () => "Driver paused sharing", icon: PauseCircle, cls: "bg-warning-soft text-warning" }
};

export function LoadAttentionCard({ d, limit = 6, className }: { d: LoadDashboard; limit?: number; className?: string }) {
  return (
    <Card className={cn("min-w-0", className)}>
      <CardHeader>
        <IconTitle icon={Siren} tone="red" sub={d.attention.length ? `${d.attention.length} of ${d.active} active loads` : `${d.active} active load${d.active === 1 ? "" : "s"}`}>
          Needs attention
        </IconTitle>
        <Link href="/loads/map" className="text-sm text-primary no-underline hover:underline">
          Loads map
        </Link>
      </CardHeader>
      {d.attention.length === 0 ? (
        <CardContent className="flex items-center gap-3 text-sm">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-success-soft text-success">
            <CheckCircle2 className="size-5" aria-hidden="true" />
          </span>
          <span>
            <span className="block font-semibold text-[#0a2463]">Every load is on track</span>
            <span className="text-muted-foreground">Late, silent or paused loads show up here first.</span>
          </span>
        </CardContent>
      ) : (
        <ul className="m-0 list-none divide-y divide-border p-0">
          {d.attention.slice(0, limit).map(({ load: l, reason }) => {
            const r = REASON[reason];
            return (
              <li key={l.id}>
                <Link href={`/loads/${l.id}`} className="group flex items-center gap-3 px-4 py-3 text-sm text-foreground no-underline transition-colors hover:bg-primary-soft/40 sm:px-5">
                  <span className={cn("grid size-9 shrink-0 place-items-center rounded-full", r.cls)}>
                    <r.icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {l.reference} <span className="font-normal text-muted-foreground">· {l.driverName ?? l.vehicle?.name ?? "Driver"}</span>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {shortPlace(l.pickup.name, l.pickup.address)} → {shortPlace(l.delivery.name, l.delivery.address)}
                    </span>
                  </span>
                  <span className={cn("hidden shrink-0 rounded-full px-2.5 py-1 text-xs font-medium sm:inline", r.cls)}>{r.label(l.eta?.lateByMinutes ?? null)}</span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {d.attention.length > limit && (
        <Link href="/loads/map" className="block border-t border-border px-5 py-2.5 text-xs text-primary no-underline hover:underline">
          {d.attention.length - limit} more on the loads map
        </Link>
      )}
    </Card>
  );
}

export function TodayStopsCard({ d, timeZone, timeFormat }: { d: LoadDashboard; timeZone: string; timeFormat: TimeFormat }) {
  const f = dateFormatter(timeZone, timeFormat);
  const now = Date.now();
  return (
    <Card className="min-w-0">
      <CardHeader>
        <IconTitle icon={CalendarClock} tone="purple" sub={d.today.length ? `${d.today.length} appointment${d.today.length === 1 ? "" : "s"} today` : "Pickup and delivery appointments for today"}>
          Today&apos;s stops
        </IconTitle>
      </CardHeader>
      {d.today.length === 0 ? (
        <CardContent className="text-sm text-muted-foreground">No appointments today.</CardContent>
      ) : (
        <ol className="m-0 list-none divide-y divide-border p-0">
          {d.today.slice(0, 8).map(({ load: l, stop, at }) => {
            const s = stop === "pickup" ? l.pickup : l.delivery;
            const past = Date.parse(at) < now;
            return (
              <li key={`${l.id}-${stop}`}>
                <Link href={`/loads/${l.id}`} className="flex items-center gap-3 px-4 py-3 text-sm text-foreground no-underline hover:bg-primary-soft/40 sm:px-5">
                  <span className={cn("w-[4.5rem] shrink-0 whitespace-nowrap font-semibold tabular-nums", past ? "text-muted-foreground" : "text-[#0a2463]")}>{f.time(new Date(at))}</span>
                  <span className={cn("size-2.5 shrink-0 rounded-full", stop === "pickup" ? "bg-[#15803d]" : "bg-[#c81e2b]")} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {stop === "pickup" ? "Pickup" : "Delivery"} · {shortPlace(s.name, s.address)}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {l.reference} · {l.driverName ?? l.vehicle?.name ?? "Driver"}
                    </span>
                  </span>
                  {l.eta?.late && l.eta.target === stop && <span className="shrink-0 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger">Late</span>}
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

export function DeliveriesCard({ d, timeZone, timeFormat }: { d: LoadDashboard; timeZone: string; timeFormat: TimeFormat }) {
  const f = dateFormatter(timeZone, timeFormat);
  const total = d.delivered.reduce((a, x) => a + x.count, 0);
  const onTimePct = d.month.withAppointment > 0 ? Math.round((d.month.onTime / d.month.withAppointment) * 100) : null;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <IconTitle icon={PackageCheck} tone="green" sub={`${total} delivered in the last ${d.delivered.length} days`}>
          Deliveries
        </IconTitle>
        <Link href="/loads?filter=ended" className="text-sm text-primary no-underline hover:underline">
          Completed loads
        </Link>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-muted/60 px-3 py-2.5">
            <p className="m-0 text-xs text-muted-foreground">Delivered this month</p>
            <p className="m-0 mt-0.5 text-2xl font-semibold tabular-nums text-[#0a2463]">{d.month.delivered}</p>
          </div>
          <div className="rounded-lg bg-muted/60 px-3 py-2.5">
            <p className="m-0 flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="size-3" aria-hidden="true" /> On time this month
            </p>
            <p className="m-0 mt-0.5 text-2xl font-semibold tabular-nums text-[#0a2463]">{onTimePct === null ? "—" : `${onTimePct}%`}</p>
            <p className="m-0 text-[11px] text-muted-foreground">{onTimePct === null ? "Needs delivery appointments" : `${d.month.onTime} of ${d.month.withAppointment} with an appointment`}</p>
          </div>
        </div>
        <ColumnChart
          ariaLabel="Loads delivered per day"
          tableHeads={["Day", "Delivered"]}
          labelEvery={3}
          data={d.delivered.map((x) => ({ key: x.day, label: f.day(x.day).replace(/^\w+, /, ""), longLabel: f.day(x.day), value: x.count, valueLabel: `${x.count} load${x.count === 1 ? "" : "s"}` }))}
        />
      </CardContent>
    </Card>
  );
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

/** This month's loads against the plan's allowance (Org admins: they see what it costs). */
export function LoadUsageCard({ used, allowance }: { used: { loadsUsed: number; included: number; extraLoadCents: number } | null; allowance?: LoadAllowance }) {
  if (!used) return null;
  const over = used.included > 0 && used.loadsUsed > used.included;
  return (
    <Card>
      <CardHeader>
        <IconTitle icon={Truck} sub="Loads count when tracking starts">
          Loads this month
        </IconTitle>
        <Link href="/settings/plan" className="text-sm text-primary no-underline hover:underline">
          Plan &amp; usage
        </Link>
      </CardHeader>
      <CardContent className="grid gap-2">
        <UsageMeter label="Used" used={used.loadsUsed} included={used.included} />
        <p className="m-0 text-xs text-muted-foreground">
          {used.included === 0
            ? `Every load is ${money(used.extraLoadCents)}.`
            : over
              ? `Extra loads are ${money(used.extraLoadCents)} each. Your work never stops.`
              : `${used.included - used.loadsUsed} included load${used.included - used.loadsUsed === 1 ? "" : "s"} left${allowance?.level === "near" ? " — running low" : ""}.`}
        </p>
      </CardContent>
    </Card>
  );
}
