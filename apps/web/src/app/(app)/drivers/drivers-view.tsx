"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { BadgeAlert, Car, ChevronDown, Download, History, IdCard, Layers, LocateFixed, Map as MapIcon, MapPinOff, Navigation, Package, Pencil, Phone, Plus, RefreshCw, Send, Smartphone, SmartphoneNfc, Trash2, UserCheck, UserMinus, UserPlus, UserX, Users, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AssignLoadDialog } from "./assign-load-dialog";
import { AppStateChip, Battery } from "./driver-app-bits";
import { InviteDriversDialog } from "./invite-drivers-dialog";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { DataTable, type ColumnMeta } from "@/components/app/data-table";
import { FilterTiles } from "@/components/app/list-kit";
import { RelativeTime } from "@/components/app/local-time";
import { PageHeader } from "@/components/app/page-header";
import { SearchInput } from "@/components/app/search-input";
import { EmptyState } from "@/components/app/states";
import { useListParams } from "@/components/app/use-list-params";
import { useUnits } from "@/components/app/units-context";
import { VehiclePicture } from "@/components/app/vehicle-picture";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import type { DriverListQuery, DriverRow } from "@/lib/drivers";
import { asVehicleType, VEHICLE_TYPE_LABEL } from "@/lib/schemas/vehicle";
import { DriverFormDialog, type VehicleOption } from "./driver-form-dialog";
import { DriverRecordPanel } from "./driver-record";
import { StatusChip } from "@/components/app/status-chip";
import { DensityToggle, PlateTag, useDensity } from "@/components/app/vehicle-tags";
import { useTime } from "@/components/app/time-context";
import { cn } from "@/lib/cn";
import { Input, Select } from "@/components/ui/input";

type Data = { items: DriverRow[]; total: number; page: number; pageSize: number; counts: Record<DriverListQuery["state"], number> };
type Can = { create: boolean; update: boolean; remove: boolean; map: boolean; loads: boolean };

const LINK_CHIP: Record<string, { label: string; cls: string; title: string }> = {
  pending: { label: "Request pending", cls: "bg-warning-soft text-warning", title: "Waiting for the driver to accept in the RIO GPS app" },
  declined: { label: "Declined", cls: "bg-danger-soft text-danger", title: "The driver declined. You can ask again." },
  left: { label: "Left", cls: "bg-muted text-muted-foreground", title: "The driver stopped working with you in the app. You can ask again." }
};
const LOAD_STATUS: Record<string, string> = { invited: "Waiting", tracking: "Tracking", at_pickup: "At pickup", in_transit: "In transit", at_delivery: "At delivery" };

function toCsv(rows: DriverRow[]): string {
  const esc = (v: string | null | undefined) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const head = ["Name", "Phone", "Email", "Status", "In app", "Vehicle", "Load", "Licence", "Licence expires"];
  return [head.join(","), ...rows.map((d) => [d.name, d.phone, d.email, d.status, d.link.state === "active" ? d.app.state : d.link.state, d.vehicle?.name, d.load?.reference, d.licenseNumber, d.licenseExpiresOn].map(esc).join(","))].join("\n");
}

const AVATAR = ["#1d4ed8", "#0f766e", "#6d28d9", "#b45309", "#be185d", "#0369a1", "#15803d", "#c2410c"];
const initials = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";
const hue = (n: string) => AVATAR[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR.length]!;

/** Days until the licence expires (negative once expired), from a yyyy-mm-dd date. */
function licenseDays(d: string | null): number | null {
  if (!d) return null;
  const end = new Date(`${d}T23:59:59`);
  return Math.floor((end.getTime() - Date.now()) / 86_400_000);
}

export function DriverAvatar({ name, className = "size-9 text-sm" }: { name: string; className?: string }) {
  const c = hue(name);
  return (
    <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-full font-semibold text-white ${className}`} style={{ background: `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 65%, #000))` }}>
      {initials(name)}
    </span>
  );
}

/** Drivers and the vehicle each one drives now, with quick assign / reassign. */
export function DriversView({ data, query, can, vehicles, joinCode = null, openInvite = false, companyName, smsReady }: { data: Data; query: DriverListQuery; can: Can; vehicles: VehicleOption[]; joinCode?: string | null; openInvite?: boolean; companyName: string; smsReady: boolean }) {
  const [invite, setInvite] = useState<null | { prefill?: { id: string; name: string; phone: string | null }[] }>(openInvite ? {} : null);
  const u = useUnits();
  const { set, refresh, pending } = useListParams();
  const [form, setForm] = useState<{ driver: DriverRow | null } | null>(null);
  const [deleting, setDeleting] = useState<DriverRow | null>(null);
  const [freeing, setFreeing] = useState<DriverRow | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState<DriverRow | null>(null);
  const [bulkRemove, setBulkRemove] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const picked = data.items.filter((d) => checked.has(d.id));
  const toggle = (id: string) =>
    setChecked((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allOnPage = data.items.length > 0 && data.items.every((d) => checked.has(d.id));

  async function askAgain(d: DriverRow) {
    try {
      await api(`/api/drivers/${d.id}/request`, { method: "POST" });
      toast.success(`Asked ${d.name} again. They'll see it in the RIO GPS app.`);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  async function askLocation(d: DriverRow) {
    try {
      await api(`/api/drivers/${d.id}/ask-location`, { method: "POST", json: {} });
      toast.success(`Asked ${d.name} to turn on location`);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  async function runBulk(label: string, list: DriverRow[], fn: (d: DriverRow) => Promise<unknown>) {
    setBulkBusy(true);
    let ok = 0;
    const failed: string[] = [];
    for (const d of list) {
      try {
        await fn(d);
        ok++;
      } catch {
        failed.push(d.name);
      }
    }
    setBulkBusy(false);
    if (ok) toast.success(`${label}: ${ok} driver${ok === 1 ? "" : "s"}`);
    if (failed.length) toast.error(`Couldn't do it for ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? ` and ${failed.length - 3} more` : ""}`);
    setChecked(new Set());
    refresh();
  }
  function exportCsv(list: DriverRow[]) {
    const blob = new Blob([toCsv(list)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `drivers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  const selected = data.items.find((d) => d.id === selectedId) ?? null;
  const [density, setDensity] = useDensity("drivers");
  const time = useTime();
  const c = data.counts;
  const filtered = query.search !== "" || query.state !== "all";

  const columns = useMemo<ColumnDef<DriverRow, unknown>[]>(
    () => [
      {
        id: "pick",
        header: () => (
          <input
            type="checkbox"
            aria-label="Select all drivers on this page"
            className="size-4 accent-[var(--primary)]"
            checked={allOnPage}
            onChange={() => setChecked(allOnPage ? new Set() : new Set(data.items.map((d) => d.id)))}
          />
        ),
        meta: { width: "40px" } satisfies ColumnMeta,
        cell: ({ row: { original: d } }) => (
          <input type="checkbox" aria-label={`Select ${d.name}`} className="size-4 accent-[var(--primary)]" checked={checked.has(d.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(d.id)} />
        )
      },
      {
        id: "name",
        header: "Driver",
        meta: { sortKey: "name", width: "24%" } satisfies ColumnMeta,
        cell: ({ row: { original: d } }) => (
          <div className={cn("flex min-w-0 items-center gap-3", d.status === "inactive" && "opacity-60")}>
            <span className="relative shrink-0">
              <DriverAvatar name={d.name} className="size-8 text-xs" />
              <span title={d.status === "active" ? "Active" : "Inactive"} className={cn("absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-background", d.status === "active" ? "bg-success" : "bg-muted-foreground/60")} />
            </span>
            <div className="min-w-0">
              <p className="m-0 flex items-center gap-1.5 truncate font-semibold text-foreground">
                {d.name}
                {d.status === "inactive" && <span className="inline-flex h-[18px] items-center rounded-full bg-muted px-1.5 text-[10.5px] font-bold text-muted-foreground">Inactive</span>}
                {d.status === "active" && LINK_CHIP[d.link.state] && (
                  <span title={LINK_CHIP[d.link.state]!.title} className={cn("inline-flex h-[18px] shrink-0 items-center rounded-full px-1.5 text-[10.5px] font-bold", LINK_CHIP[d.link.state]!.cls)}>
                    {LINK_CHIP[d.link.state]!.label}
                  </span>
                )}
              </p>
              <p className="m-0 flex items-center gap-1 truncate text-xs text-muted-foreground">
                {d.phone ? (
                  <a href={`tel:${d.phone}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-muted-foreground no-underline hover:text-primary">
                    <Phone className="size-3" aria-hidden="true" />
                    {d.phone}
                  </a>
                ) : (
                  (d.email ?? "No phone")
                )}
              </p>
            </div>
          </div>
        )
      },
      {
        id: "vehicle",
        header: "Vehicle now",
        meta: { sortKey: "vehicle", width: "20%" } satisfies ColumnMeta,
        cell: ({ row: { original: d } }) =>
          d.vehicle ? (
            <Link href={`/vehicles/${d.vehicle.id}`} onClick={(e) => e.stopPropagation()} className="flex min-w-0 items-center gap-2.5 text-foreground no-underline hover:underline" title={VEHICLE_TYPE_LABEL[asVehicleType(d.vehicle.type)]}>
              <VehiclePicture type={d.vehicle.type} state={d.vehicle.moving ? "moving" : d.vehicle.deviceId ? "stopped" : undefined} className="h-8 w-11" />
              <span className="grid min-w-0">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate font-semibold">{d.vehicle.name}</span>
                  <PlateTag plate={d.vehicle.licensePlate} />
                </span>
                <span className="truncate text-xs text-muted-foreground">{d.assignedAt ? `since ${time.date(d.assignedAt)}` : "Assigned"}</span>
              </span>
            </Link>
          ) : d.status === "active" && can.update ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation();
                setForm({ driver: d });
              }}
            >
              <Car /> Assign vehicle
            </Button>
          ) : (
            <span className="text-muted-foreground">—</span>
          )
      },
      {
        id: "now",
        header: "Now",
        meta: { width: "17%" } satisfies ColumnMeta,
        cell: ({ row: { original: d } }) => {
          if (d.status === "inactive") return <span className="text-xs text-muted-foreground">Off</span>;
          if (d.link.state !== "active") return <span className="text-xs text-muted-foreground">{d.link.state === "pending" ? "Not sharing until they accept" : "Not sharing with you"}</span>;
          const app = (
            <span className="flex items-center gap-1.5">
              <AppStateChip state={d.app.state} className="h-5 px-1.5 text-[11px]" />
              {(d.app.state === "sharing" || d.app.state === "stale") && <Battery pct={d.app.batteryPct} charging={d.app.charging} />}
            </span>
          );
          if (d.vehicle?.moving) return <span className="grid gap-1"><StatusChip status="moving" label={`Driving · ${u.fmtSpeed(d.vehicle.speedKph ?? 0)}`} />{app}</span>;
          if (!d.vehicle?.deviceId && d.app.state === "sharing" && (d.app.speedKph ?? 0) >= 5) return <span className="grid gap-1"><StatusChip status="moving" label={`Driving · ${u.fmtSpeed(d.app.speedKph ?? 0)}`} />{app}</span>;
          return (
            <span className="grid gap-1">
              {d.vehicle?.deviceId ? <StatusChip status="stopped" label="Not driving" /> : null}
              {app}
            </span>
          );
        }
      },
      {
        id: "load",
        header: "Load",
        meta: { width: "14%" } satisfies ColumnMeta,
        cell: ({ row: { original: d } }) =>
          d.load ? (
            <Link href={`/loads/${d.load.id}`} onClick={(e) => e.stopPropagation()} className="grid min-w-0 text-foreground no-underline hover:underline">
              <span className="flex items-center gap-1.5 truncate font-semibold">
                <Package className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                {d.load.reference}
              </span>
              <span className="truncate text-xs text-muted-foreground">{LOAD_STATUS[d.load.status] ?? d.load.status}</span>
            </Link>
          ) : d.status === "active" && can.loads ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation();
                setAssigning(d);
              }}
            >
              <Package /> Assign load
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">No load</span>
          )
      },
      {
        id: "license",
        header: "Licence",
        meta: { sortKey: "license", hideable: true, label: "Licence", width: "11%" } satisfies ColumnMeta,
        cell: ({ row: { original: d } }) => {
          const days = licenseDays(d.licenseExpiresOn);
          if (days == null) return <span className="text-xs text-muted-foreground">{d.licenseNumber ?? "—"}</span>;
          return (
            <div className="grid min-w-0 gap-0.5" title={d.licenseNumber ? `Licence ${d.licenseNumber}` : undefined}>
              {days < 0 ? (
                <span className="inline-flex h-5 w-fit items-center rounded-full bg-danger-soft px-2 text-[11px] font-bold text-danger">Expired</span>
              ) : days <= 30 ? (
                <span className="inline-flex h-5 w-fit items-center rounded-full bg-warning-soft px-2 text-[11px] font-bold text-warning">{days} days left</span>
              ) : (
                <span className="text-xs font-semibold text-foreground/80">Valid</span>
              )}
              <span className="truncate text-[11px] text-muted-foreground">{time.date(`${d.licenseExpiresOn}T12:00:00Z`)}</span>
            </div>
          );
        }
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Manage</span>,
        meta: { className: "whitespace-nowrap text-right", width: "110px" } satisfies ColumnMeta,
        cell: ({ row: { original: d } }) => {
          const mapId = d.vehicle?.deviceId ?? (d.app.phoneDeviceId && d.app.state !== "no_app" ? d.app.phoneDeviceId : null);
          const linkOpen = d.link.state === "active";
          return (
            <span onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="secondary" aria-label={`Manage ${d.name}`}>
                    Manage <ChevronDown aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="min-w-[220px]">
                  <DropdownMenuLabel>{d.name}</DropdownMenuLabel>
                  {can.map && mapId && linkOpen && (
                    <DropdownMenuItem asChild>
                      <Link href={`/map?focus=${mapId}`}>
                        <MapIcon aria-hidden="true" /> Show on map
                      </Link>
                    </DropdownMenuItem>
                  )}
                  {can.map && d.vehicle?.deviceId && (
                    <DropdownMenuItem asChild>
                      <Link href={`/map?device=${d.vehicle.deviceId}&from=${encodeURIComponent(new Date(new Date().setHours(0, 0, 0, 0)).toISOString())}`}>
                        <History aria-hidden="true" /> Today&apos;s trips
                      </Link>
                    </DropdownMenuItem>
                  )}
                  {can.loads && d.status === "active" && (
                    <DropdownMenuItem onSelect={() => setAssigning(d)}>
                      <Package aria-hidden="true" /> {d.load ? "Assign another load" : "Assign load"}
                    </DropdownMenuItem>
                  )}
                  {can.update && d.status === "active" && linkOpen && d.app.state !== "no_app" && d.app.state !== "signed_out" && (
                    <DropdownMenuItem onSelect={() => askLocation(d)}>
                      <LocateFixed aria-hidden="true" /> Ask for location
                    </DropdownMenuItem>
                  )}
                  {can.update && d.status === "active" && d.phone && (d.link.state === "declined" || d.link.state === "left" || d.link.state === "pending") && (
                    <DropdownMenuItem onSelect={() => askAgain(d)}>
                      <RefreshCw aria-hidden="true" /> {d.link.state === "pending" ? "Remind to accept" : "Ask again"}
                    </DropdownMenuItem>
                  )}
                  {can.create && d.status === "active" && (d.app.state === "no_app" || d.app.state === "signed_out") && (
                    <DropdownMenuItem onSelect={() => setInvite({ prefill: [{ id: d.id, name: d.name, phone: d.phone }] })}>
                      <Send aria-hidden="true" /> Send app link
                    </DropdownMenuItem>
                  )}
                  {can.update && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => setForm({ driver: d })}>
                        <Pencil aria-hidden="true" /> Edit driver
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setForm({ driver: d })}>
                        <Car aria-hidden="true" /> {d.vehicle ? "Change vehicle" : "Assign vehicle"}
                      </DropdownMenuItem>
                      {d.vehicle && (
                        <DropdownMenuItem onSelect={() => setFreeing(d)}>
                          <UserMinus aria-hidden="true" /> Take off vehicle
                        </DropdownMenuItem>
                      )}
                    </>
                  )}
                  {can.remove && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem destructive onSelect={() => setDeleting(d)}>
                        <Trash2 aria-hidden="true" /> Remove from company
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          );
        }
      }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can, u, time, checked, allOnPage, data.items]
  );

  return (
    <>
      <PageHeader
        title="Drivers"
        description={`${c.active ?? 0} active · ${c.sharing ?? 0} sharing location${c.location_off ? ` · ${c.location_off} location off` : ""}${c.pending ? ` · ${c.pending} waiting to accept` : ""}${c.no_app ? ` · ${c.no_app} not in the app` : ""}`}
        actions={
          can.create && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setInvite({})}>
                <UserPlus /> Add by phone
              </Button>
              <Button onClick={() => setForm({ driver: null })}>
                <Plus /> Add driver
              </Button>
            </div>
          )
        }
      />
      {invite && <InviteDriversDialog companyName={companyName} code={joinCode} vehicles={vehicles} smsReady={smsReady} prefill={invite.prefill} onClose={() => setInvite(null)} onDone={refresh} />}
      <FilterTiles
        label="Filter drivers"
        value={query.state}
        onChange={(state) => set({ state: state === "all" ? null : state })}
        options={[
          { value: "all", label: "All drivers", count: c.all ?? 0, icon: Layers, color: "#133a8f" },
          { value: "active", label: "Active", count: c.active ?? 0, icon: UserCheck, color: "#15803d" },
          { value: "sharing", label: "Sharing", count: c.sharing ?? 0, icon: SmartphoneNfc, color: "#0369a1" },
          { value: "location_off", label: "Location off", count: c.location_off ?? 0, icon: MapPinOff, color: "#b91c1c" },
          { value: "pending", label: "Waiting to accept", count: c.pending ?? 0, icon: UserPlus, color: "#b45309" },
          { value: "no_app", label: "No app yet", count: c.no_app ?? 0, icon: Smartphone, color: "#c2410c" },
          { value: "driving", label: "Driving now", count: c.driving ?? 0, icon: Navigation, color: "#15803d" },
          { value: "unassigned", label: "No vehicle", count: c.unassigned ?? 0, icon: Users, color: "#b45309" },
          { value: "license", label: "Licence due", count: c.license ?? 0, icon: BadgeAlert, color: "#b91c1c" },
          { value: "inactive", label: "Inactive", count: c.inactive ?? 0, icon: UserX, color: "#475569" }
        ]}
      />
      {picked.length > 0 && (
        <div role="toolbar" aria-label="Selected drivers" className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 shadow-sm">
          <span className="text-sm font-semibold text-foreground">{picked.length} selected</span>
          <span className="flex-1" />
          {can.update && (
            <Button size="sm" variant="secondary" loading={bulkBusy} onClick={() => runBulk("Asked for location", picked.filter((d) => d.status === "active" && d.link.state === "active"), (d) => api(`/api/drivers/${d.id}/ask-location`, { method: "POST", json: {} }))}>
              <LocateFixed /> Ask for location
            </Button>
          )}
          {can.update && picked.some((d) => d.link.state !== "active" && d.phone) && (
            <Button size="sm" variant="secondary" loading={bulkBusy} onClick={() => runBulk("Asked again", picked.filter((d) => d.link.state !== "active" && d.phone), (d) => api(`/api/drivers/${d.id}/request`, { method: "POST" }))}>
              <RefreshCw /> Ask again
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => exportCsv(picked)}>
            <Download /> Export
          </Button>
          {can.remove && (
            <Button size="sm" variant="secondary" className="text-danger" onClick={() => setBulkRemove(true)}>
              <Trash2 /> Remove
            </Button>
          )}
          <Button size="sm" variant="ghost" aria-label="Clear selection" onClick={() => setChecked(new Set())}>
            <X />
          </Button>
        </div>
      )}
      <Card className="min-w-0">
        <DataTable
          columns={columns}
          data={data.items}
          getRowId={(d) => d.id}
          total={data.total}
          page={data.page}
          pageSize={data.pageSize}
          sort={query.sort}
          direction={query.direction}
          onSort={(sort, direction) => set({ sort, direction })}
          onPage={(page) => set({ page })}
          onPageSize={(pageSize) => set({ pageSize })}
          onRowClick={(d) => setSelectedId(d.id === selectedId ? null : d.id)}
          rowLabel={(d) => `Open ${d.name}'s record`}
          loading={pending}
          layout="fixed"
          minWidth={1080}
          density={density}
          toolbar={
            <>
              <SearchInput value={query.search} onChange={(search) => set({ search })} placeholder="Search name, phone, licence or vehicle…" label="Search drivers" />
              <Select
                aria-label="Sort drivers"
                className="w-auto min-w-[11rem]"
                value={`${query.sort}:${query.direction}`}
                onChange={(e) => {
                  const [sort, direction] = e.target.value.split(":");
                  set({ sort: sort!, direction: direction! });
                }}
              >
                <option value="driving:asc">Sort: Driving first</option>
                <option value="name:asc">Sort: Name A–Z</option>
                <option value="vehicle:asc">Sort: Vehicle</option>
                <option value="license:asc">Sort: Licence expiry</option>
              </Select>
              <span className="hidden flex-1 md:block" />
              <DensityToggle value={density} onChange={setDensity} />
            </>
          }
          empty={
            <EmptyState
              icon={IdCard}
              title={filtered ? "No drivers match" : "No drivers yet"}
              description={filtered ? "Try another search or filter." : "Add your drivers and the vehicle each one drives. Their name then shows on the live map, vehicles and trips."}
              action={
                !filtered && can.create ? (
                  <Button onClick={() => setForm({ driver: null })}>
                    <Plus /> Add driver
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </Card>
      {/* The record opens as a drawer over the right of the page, so the table keeps its full width. */}
      {selected && (
        <div className="fixed inset-x-2 bottom-2 top-16 z-40 overflow-y-auto overscroll-contain rounded-2xl animate-in sm:left-auto sm:right-4 sm:top-[72px] sm:w-[400px]">
          <DriverRecordPanel driver={selected} canUpdate={can.update} onEdit={() => setForm({ driver: selected })} onInvite={can.create ? () => setInvite({ prefill: [{ id: selected.id, name: selected.name, phone: selected.phone }] }) : undefined} onClose={() => setSelectedId(null)} onChanged={refresh} />
        </div>
      )}
      {assigning && <AssignLoadDialog driver={assigning} onClose={() => setAssigning(null)} onDone={refresh} />}
      <ConfirmDialog
        open={bulkRemove}
        onOpenChange={setBulkRemove}
        title={`Remove ${picked.length} driver${picked.length === 1 ? "" : "s"} from your company?`}
        description="They stop sharing their location with you. Their past trips stay with their vehicles. To keep their record, set them to Inactive instead."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          setBulkRemove(false);
          await runBulk("Removed", picked, (d) => api(`/api/drivers/${d.id}`, { method: "DELETE" }));
        }}
      />
      {form && <DriverFormDialog open onOpenChange={(o) => !o && setForm(null)} driver={form.driver} vehicles={vehicles} onSaved={refresh} />}
      <ConfirmDialog
        open={!!freeing}
        onOpenChange={(o) => !o && setFreeing(null)}
        title={`Take ${freeing?.name ?? ""} off ${freeing?.vehicle?.name ?? "the vehicle"}?`}
        description="The vehicle stays tracked; it just has no driver until you assign one."
        confirmLabel="Take off vehicle"
        onConfirm={async () => {
          try {
            await api(`/api/drivers/${freeing!.id}`, { method: "PATCH", json: { vehicleId: null } });
            toast.success("Driver taken off the vehicle");
            setFreeing(null);
            refresh();
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Remove ${deleting?.name ?? "driver"} from your company?`}
        description="They stop sharing their location with you and the record is removed. To keep their history, edit them and set them to Inactive instead."
        confirmLabel="Remove driver"
        destructive
        onConfirm={async () => {
          try {
            await api(`/api/drivers/${deleting!.id}`, { method: "DELETE" });
            toast.success("Driver removed");
            setDeleting(null);
            refresh();
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
    </>
  );
}
