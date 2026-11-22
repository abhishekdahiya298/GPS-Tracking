"use client";
import { AlertTriangle, ChevronLeft, Clock, Cpu, Fuel, Gauge, History, IdCard, KeyRound, Layers, Map as MapIcon, MapPin, Pencil, Phone, Route, Share2, Tag, Timer, Truck, Wrench } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { AssignmentRow } from "@/lib/drivers";
import type { AlertEventDto } from "@/lib/alerts";
import type { ItemDto } from "@/lib/maintenance";
import type { VehicleDetail, VehicleWeek } from "@/lib/fleet-list";
import { alertMeta } from "@/lib/alert-meta";
import { cn } from "@/lib/cn";
import { deviceDisplayName, productName } from "@/lib/device-name";
import { asVehicleType, FUEL_LABEL, VEHICLE_TYPE_LABEL } from "@/lib/schemas/vehicle";
import { useAddress } from "@/lib/use-address";
import { LocalTime, RelativeTime } from "@/components/app/local-time";
import { StatusChip, STATUS_THEME } from "@/components/app/status-chip";
import { useTime } from "@/components/app/time-context";
import { useUnits } from "@/components/app/units-context";
import { OrderBadge, PlateTag, VinTag, yearMakeModel } from "@/components/app/vehicle-tags";
import { pictureState, VehiclePicture } from "@/components/app/vehicle-picture";
import { Button } from "@/components/ui/button";
import { DriverAvatar } from "../../drivers/drivers-view";

const VehicleFormDialog = dynamic(() => import("../../_fleet/vehicle-form-dialog").then((m) => m.VehicleFormDialog));
const ShareDialog = dynamic(() => import("../share-dialog").then((m) => m.ShareDialog));

/** 7h 12m · 45m */
function hm(seconds: number) {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}
function daysBetween(a: string, b: string | null) {
  return Math.max(1, Math.round(((b ? Date.parse(b) : Date.now()) - Date.parse(a)) / 86_400_000));
}

const MAINT_COLOR = { overdue: "#b91c1c", due_soon: "#c2410c", ok: "#15803d" } as const;

function Panel({ title, icon: Icon, color, action, children, className }: { title: string; icon: typeof Truck; color: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 overflow-hidden rounded-2xl border border-border bg-background shadow-card", className)}>
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-2.5">
        <span className="grid size-7 place-items-center rounded-lg text-white" style={{ background: `linear-gradient(150deg, color-mix(in srgb, ${color} 80%, #fff), ${color})` }}>
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <h2 className="m-0 flex-1 text-sm font-bold text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, icon: Icon, color }: { label: string; value: string; icon: typeof Truck; color: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl px-3 py-2.5 shadow-card" style={{ background: `linear-gradient(120deg, var(--color-background) 45%, color-mix(in srgb, ${color} 13%, var(--color-background)))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 22%, transparent)` }}>
      <span className="grid size-8 shrink-0 place-items-center rounded-lg text-white" style={{ background: `linear-gradient(150deg, color-mix(in srgb, ${color} 75%, #fff), ${color})` }}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="grid min-w-0 leading-tight">
        <b className="truncate text-base tabular-nums text-foreground">{value}</b>
        <span className="truncate text-xs text-muted-foreground">{label}</span>
      </span>
    </div>
  );
}

function InfoTile({ label, value, icon: Icon, mono }: { label: string; value: ReactNode; icon: typeof Truck; mono?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl bg-canvas px-3 py-2 shadow-[inset_0_0_0_1px_var(--color-border)]">
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <span className="grid min-w-0 leading-tight">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <b className={cn("truncate text-[13px] text-foreground", mono && "font-mono tracking-wide")}>{value}</b>
      </span>
    </div>
  );
}

export function VehiclePageView({
  detail,
  week,
  drivers,
  alerts,
  maintenance,
  can
}: {
  detail: VehicleDetail;
  week: VehicleWeek | null;
  drivers: AssignmentRow[];
  alerts: AlertEventDto[];
  maintenance: ItemDto[] | null;
  can: { update: boolean; map: boolean; share: boolean };
}) {
  const u = useUnits();
  const time = useTime();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const v = detail.vehicle;
  const loc = detail.location;
  const ymm = yearMakeModel(v);
  const silent = ["offline", "never_seen", "inactive", "parked"].includes(detail.state);
  const address = useAddress(loc ? loc.latitude : null, loc ? loc.longitude : null, detail.state === "moving");
  const color = STATUS_THEME[detail.state].color;
  const tripsHref = () => (detail.device ? `/map?trips=${detail.device.id}` : "/map");
  const maxDay = Math.max(1, ...(week?.days.map((d) => d.distanceM) ?? [1]));

  return (
    <div className="grid gap-4">
      {/* Header */}
      <section className="relative overflow-hidden rounded-2xl border border-border p-4 shadow-card" style={{ background: `linear-gradient(120deg, var(--color-background) 45%, color-mix(in srgb, ${color} 14%, var(--color-background)))` }}>
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1.5" style={{ background: color }} />
        <div className="flex flex-wrap items-center gap-4">
          <VehiclePicture type={v.type} state={pictureState(detail.device ? detail.state : null)} className="h-16 w-24 shrink-0 rounded-xl bg-background" />
          <div className="grid min-w-[16rem] flex-1 gap-1">
            <Link href="/vehicles" className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-primary no-underline hover:underline">
              <ChevronLeft className="size-3.5" aria-hidden="true" /> Vehicles
            </Link>
            <h1 className="m-0 flex flex-wrap items-center gap-2 text-2xl font-extrabold tracking-tight text-primary">
              {v.name}
              <OrderBadge order={v.sortOrder} />
              {ymm && <span className="text-sm font-semibold text-muted-foreground">{ymm}</span>}
            </h1>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusChip status={detail.state} label={detail.state === "moving" && loc ? `Moving · ${u.fmtSpeed(loc.speedKph)}` : undefined} />
              {v.status !== "active" && <span className="inline-flex h-6 items-center rounded-full bg-warning-soft px-2.5 text-xs font-semibold text-warning">{v.status === "maintenance" ? "In maintenance" : "Inactive"}</span>}
              <span className="inline-flex h-6 items-center gap-1 rounded-full bg-muted px-2.5 text-xs font-semibold text-foreground/80">
                <Truck className="size-3.5" aria-hidden="true" /> {VEHICLE_TYPE_LABEL[asVehicleType(v.type)]}
              </span>
              <PlateTag plate={v.licensePlate ? (v.plateRegion ? `${v.licensePlate} · ${v.plateRegion}` : v.licensePlate) : null} className="h-6 px-2 text-xs" />
              <VinTag vin={v.vin} className="h-6 px-2 text-xs" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {can.map && detail.device && loc && (
              <Button asChild>
                <Link href={`/map?focus=${detail.device.id}`}>
                  <MapIcon /> Show on map
                </Link>
              </Button>
            )}
            {can.map && detail.device && (
              <Button variant="secondary" onClick={() => router.push(tripsHref())}>
                <History /> Trip history
              </Button>
            )}
            {can.share && detail.device && (
              <Button variant="secondary" onClick={() => setSharing(true)}>
                <Share2 /> Share
              </Button>
            )}
            {can.update && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* Last 7 days */}
      {week && (
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
          <Stat label="Distance · 7 days" value={u.fmtDist(week.distanceM / 1000, 0)} icon={Route} color="#1d4ed8" />
          <Stat label="Driving · 7 days" value={hm(week.drivingS)} icon={Clock} color="#15803d" />
          <Stat label="Idling · 7 days" value={hm(week.idleS)} icon={Timer} color="#c2410c" />
          <Stat label="Trips · 7 days" value={String(week.trips)} icon={History} color="#6d28d9" />
          <Stat label="Top speed · 7 days" value={week.maxSpeedKph ? u.fmtSpeed(week.maxSpeedKph) : "—"} icon={Gauge} color="#b91c1c" />
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        {/* Now */}
        <Panel title="Right now" icon={MapPin} color="#1d4ed8" className="lg:col-span-2" action={loc ? <span className="text-xs text-muted-foreground">Updated <RelativeTime iso={loc.recordedAt} /></span> : undefined}>
          {loc ? (
            <div className="grid gap-3 p-4">
              <div className="flex items-start gap-3 rounded-xl bg-primary-soft px-3.5 py-3">
                <MapPin className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-base font-bold [overflow-wrap:anywhere]">{address ? address.line1 : `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`}</p>
                  <p className="m-0 text-sm text-foreground/75">{address?.line2 ?? "Street address loads when the address service is on"}</p>
                  <p className="m-0 mt-0.5 text-xs text-muted-foreground tabular-nums">
                    {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)} · <LocalTime iso={loc.recordedAt} />
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <InfoTile icon={Gauge} label="Speed" value={silent ? "—" : u.fmtSpeed(detail.state === "moving" ? loc.speedKph : 0)} />
                <InfoTile icon={KeyRound} label="Ignition" value={silent || loc.ignition === null ? "Unknown" : loc.ignition ? "On" : "Off"} />
                <InfoTile icon={Clock} label="Last seen" value={<RelativeTime iso={detail.lastSeenAt} />} />
              </div>
            </div>
          ) : (
            <p className="m-0 p-4 text-sm text-muted-foreground">{detail.device ? "No position received yet." : "Assign a GPS device to see where this vehicle is."}</p>
          )}
        </Panel>

        {/* Driver + device */}
        <div className="grid content-start gap-4">
          <Panel title="Driver" icon={IdCard} color="#0f766e" action={<Link href="/drivers" className="text-xs font-semibold text-primary no-underline hover:underline">{detail.driver ? "Change" : "Assign"}</Link>}>
            <div className="flex items-center gap-3 p-4">
              {detail.driver ? (
                <>
                  <DriverAvatar name={detail.driver.name} className="size-10 text-sm" />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 truncate font-bold">{detail.driver.name}</p>
                    <p className="m-0 text-xs text-muted-foreground">{drivers[0] && !drivers[0].unassignedAt ? `Since ${time.date(drivers[0].assignedAt)}` : "Current driver"}</p>
                  </div>
                  {detail.driver.phone && (
                    <a href={`tel:${detail.driver.phone}`} className="inline-flex h-8 items-center gap-1 rounded-lg bg-success-soft px-2.5 text-xs font-semibold text-success no-underline">
                      <Phone className="size-3.5" aria-hidden="true" /> Call
                    </a>
                  )}
                </>
              ) : (
                <p className="m-0 text-sm text-muted-foreground">No driver assigned.</p>
              )}
            </div>
          </Panel>
          <Panel title="GPS device" icon={Cpu} color="#475569">
            <div className="grid gap-1 p-4 text-sm">
              {detail.device ? (
                <>
                  <p className="m-0 font-bold">{deviceDisplayName(detail.device.name, detail.device.model)}</p>
                  <p className="m-0 text-xs text-muted-foreground">
                    {productName(detail.device.model)}
                    {detail.device.imeiLast4 && ` · IMEI …${detail.device.imeiLast4}`} · on this vehicle since <LocalTime iso={detail.device.assignedAt} />
                  </p>
                </>
              ) : (
                <p className="m-0 text-muted-foreground">No device assigned.</p>
              )}
            </div>
          </Panel>
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        {/* Distance by day */}
        {week && (
          <Panel title="Distance, last 7 days" icon={Route} color="#1d4ed8">
            <ul className="m-0 grid list-none gap-1.5 p-4">
              {week.days.length === 0 ? (
                <li className="text-sm text-muted-foreground">No driving recorded this week.</li>
              ) : (
                week.days.map((d) => (
                  <li key={d.day} className="grid grid-cols-[3.25rem_minmax(0,1fr)_4.5rem] items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{new Date(`${d.day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", timeZone: "UTC" })}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full bg-[#1d4ed8]" style={{ width: `${(d.distanceM / maxDay) * 100}%` }} />
                    </span>
                    <span className="text-right font-semibold tabular-nums">{u.fmtDist(d.distanceM / 1000, 0)}</span>
                  </li>
                ))
              )}
            </ul>
          </Panel>
        )}

        {/* Maintenance */}
        {maintenance && (
          <Panel title="Maintenance" icon={Wrench} color="#2563eb" action={<Link href="/maintenance" className="text-xs font-semibold text-primary no-underline hover:underline">All services</Link>}>
            <ul className="m-0 grid list-none gap-1.5 p-3">
              {maintenance.length === 0 ? (
                <li className="px-1 text-sm text-muted-foreground">No services set up for this vehicle.</li>
              ) : (
                maintenance.map((m) => {
                  const c = MAINT_COLOR[m.status.state];
                  return (
                    <li key={m.id} className="flex items-center gap-2.5 rounded-xl px-2.5 py-2" style={{ background: `color-mix(in srgb, ${c} 8%, var(--color-background))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${c} 22%, transparent)` }}>
                      <span className="grid size-7 shrink-0 place-items-center rounded-lg text-white" style={{ background: c }}>
                        <Wrench className="size-3.5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold">{m.name}</span>
                        <span className="block text-xs font-semibold" style={{ color: c }}>
                          {m.status.state === "overdue" ? "Overdue" : m.status.kmRemaining !== null ? `in ${u.fmtDist(Math.max(0, m.status.kmRemaining), 0)}` : m.status.daysRemaining !== null ? `in ${m.status.daysRemaining} days` : "OK"}
                        </span>
                      </span>
                    </li>
                  );
                })
              )}
            </ul>
          </Panel>
        )}

        {/* Alerts */}
        <Panel title="Recent alerts" icon={AlertTriangle} color="#b91c1c" action={<Link href="/alerts" className="text-xs font-semibold text-primary no-underline hover:underline">All alerts</Link>}>
          <ul className="m-0 grid list-none gap-1.5 p-3">
            {alerts.length === 0 ? (
              <li className="px-1 text-sm text-muted-foreground">No alerts for this vehicle.</li>
            ) : (
              alerts.map((a) => (
                <li key={a.id} className="flex items-center gap-2.5 rounded-xl bg-canvas px-2.5 py-2 shadow-[inset_0_0_0_1px_var(--color-border)]">
                  <AlertTriangle className="size-4 shrink-0 text-danger" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{alertMeta(a.type).label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    <RelativeTime iso={a.occurredAt} />
                  </span>
                </li>
              ))
            )}
          </ul>
        </Panel>
      </div>

      {/* Driver history */}
      <Panel title="Driver history" icon={IdCard} color="#0f766e" action={<Link href="/drivers" className="text-xs font-semibold text-primary no-underline hover:underline">Change driver</Link>}>
        {drivers.length === 0 ? (
          <p className="m-0 p-4 text-sm text-muted-foreground">No drivers recorded for this vehicle yet.</p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
            {drivers.map((h) => {
              const current = !h.unassignedAt;
              return (
                <li key={h.id} className={cn("flex items-center gap-2.5 rounded-xl px-3 py-2", current ? "bg-success-soft shadow-[inset_0_0_0_1px_rgb(22_163_74/0.3)]" : "bg-canvas shadow-[inset_0_0_0_1px_var(--color-border)]")}>
                  <DriverAvatar name={h.driver.name} className="size-8 text-[11px]" />
                  <span className="grid min-w-0 leading-tight">
                    <span className="flex items-center gap-1.5 truncate text-[13px] font-bold">
                      {h.driver.name}
                      {current && <span className="rounded-full bg-background px-1.5 text-[10px] font-bold text-success">Current</span>}
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {time.date(h.assignedAt)} → {h.unassignedAt ? time.date(h.unassignedAt) : "now"}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {daysBetween(h.assignedAt, h.unassignedAt)} days{h.distanceM > 0 ? ` · about ${u.fmtDist(h.distanceM / 1000, 0)}` : ""}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {/* Vehicle info */}
      <Panel title="Vehicle info" icon={Tag} color="#475569" action={can.update ? <button type="button" onClick={() => setEditing(true)} className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-primary hover:underline">Edit</button> : undefined}>
        <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <InfoTile icon={Tag} label="VIN" value={v.vin ?? "—"} mono={Boolean(v.vin)} />
          <InfoTile icon={Truck} label="Year · make · model" value={ymm ?? "—"} />
          <InfoTile icon={IdCard} label="Plate" value={v.licensePlate ? [v.licensePlate, v.plateRegion].filter(Boolean).join(" · ") : "—"} />
          <InfoTile icon={Fuel} label="Fuel" value={v.fuelType ? (FUEL_LABEL[v.fuelType as keyof typeof FUEL_LABEL] ?? v.fuelType) : "—"} />
          <InfoTile icon={Gauge} label="Odometer (as entered)" value={v.odometerKm != null ? `${u.fmtDist(v.odometerKm, 0)}${v.odometerSetAt ? ` · ${time.date(v.odometerSetAt)}` : ""}` : "—"} />
          <InfoTile icon={Layers} label="Unit number" value={v.unitNumber ?? "—"} />
          <InfoTile icon={Tag} label="Colour" value={v.color ?? "—"} />
          <InfoTile icon={Layers} label="List order" value={v.sortOrder != null ? `#${v.sortOrder}` : "Not set"} />
        </div>
      </Panel>

      {editing && <VehicleFormDialog open onOpenChange={setEditing} vehicle={{ id: v.id, name: v.name, licensePlate: v.licensePlate, type: v.type, vehicleStatus: v.status }} onSaved={() => router.refresh()} />}
      {sharing && <ShareDialog vehicle={{ id: v.id, name: v.name, hasDevice: detail.device !== null }} onClose={() => setSharing(false)} />}
    </div>
  );
}
