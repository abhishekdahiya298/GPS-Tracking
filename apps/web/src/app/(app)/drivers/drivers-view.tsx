"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { BadgeAlert, Car, History, IdCard, Layers, Map as MapIcon, Navigation, Pencil, Phone, Plus, Share2, Trash2, UserCheck, UserMinus, UserX, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { DataTable, type ColumnMeta } from "@/components/app/data-table";
import { ACTION_COLOR, FilterTiles, RowActions } from "@/components/app/list-kit";
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
type Can = { create: boolean; update: boolean; remove: boolean; map: boolean };

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
export function DriversView({ data, query, can, vehicles, joinCode = null, openInvite = false }: { data: Data; query: DriverListQuery; can: Can; vehicles: VehicleOption[]; joinCode?: string | null; openInvite?: boolean }) {
  const [invite, setInvite] = useState(openInvite);
  const u = useUnits();
  const { set, refresh, pending } = useListParams();
  const [form, setForm] = useState<{ driver: DriverRow | null } | null>(null);
  const [deleting, setDeleting] = useState<DriverRow | null>(null);
  const [freeing, setFreeing] = useState<DriverRow | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = data.items.find((d) => d.id === selectedId) ?? null;
  const [density, setDensity] = useDensity("drivers");
  const time = useTime();
  const c = data.counts;
  const filtered = query.search !== "" || query.state !== "all";

  const columns = useMemo<ColumnDef<DriverRow, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Driver",
        meta: { sortKey: "name", width: "30%" } satisfies ColumnMeta,
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
        meta: { sortKey: "vehicle", width: "27%" } satisfies ColumnMeta,
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
        meta: { width: "16%" } satisfies ColumnMeta,
        cell: ({ row: { original: d } }) => {
          if (d.status === "inactive") return <span className="text-xs text-muted-foreground">Off</span>;
          if (!d.vehicle) return <span className="text-xs text-muted-foreground">No vehicle</span>;
          if (!d.vehicle.deviceId) return <span className="text-xs text-muted-foreground">No GPS device</span>;
          return d.vehicle.moving ? (
            <StatusChip status="moving" label={`Driving · ${u.fmtSpeed(d.vehicle.speedKph ?? 0)}`} />
          ) : (
            <span className="grid gap-0.5">
              <StatusChip status="stopped" label="Not driving" />
              {d.vehicle.lastSeenAt && (
                <span className="text-[11px] text-muted-foreground">
                  <RelativeTime iso={d.vehicle.lastSeenAt} />
                </span>
              )}
            </span>
          );
        }
      },
      {
        id: "license",
        header: "Licence",
        meta: { sortKey: "license", hideable: true, label: "Licence", width: "15%" } satisfies ColumnMeta,
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
        header: () => <span className="sr-only">Actions</span>,
        meta: { className: "whitespace-nowrap text-right", width: "12%" } satisfies ColumnMeta,
        cell: ({ row: { original: d } }) => (
          <RowActions
            actions={[
              { icon: MapIcon, label: `Show ${d.vehicle?.name ?? ""} on the map`, color: ACTION_COLOR.map, href: d.vehicle?.deviceId ? `/map?focus=${d.vehicle.deviceId}` : undefined, hidden: !can.map || !d.vehicle?.deviceId },
              {
                icon: History,
                label: "Today's trips",
                color: ACTION_COLOR.history,
                href: d.vehicle?.deviceId ? `/map?device=${d.vehicle.deviceId}&from=${encodeURIComponent(new Date(new Date().setHours(0, 0, 0, 0)).toISOString())}` : undefined,
                hidden: !can.map || !d.vehicle?.deviceId
              },
              { icon: Pencil, label: "Edit driver", color: ACTION_COLOR.edit, onClick: () => setForm({ driver: d }), hidden: !can.update },
              { icon: UserMinus, label: "Take off vehicle", color: ACTION_COLOR.unlink, onClick: () => setFreeing(d), hidden: !can.update || !d.vehicle },
              { icon: Trash2, label: "Delete driver", tone: "danger", onClick: () => setDeleting(d), hidden: !can.remove }
            ]}
          />
        )
      }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can, u, time]
  );

  return (
    <>
      <PageHeader
        title="Drivers"
        description="Who drives which vehicle, and whether they are on the road now."
        actions={
          can.create && (
            <div className="flex flex-wrap gap-2">
              {joinCode && (
                <Button variant="secondary" onClick={() => setInvite(true)}>
                  <Share2 /> Invite drivers
                </Button>
              )}
              <Button onClick={() => setForm({ driver: null })}>
                <Plus /> Add driver
              </Button>
            </div>
          )
        }
      />
      {invite && joinCode && <InviteDriversDialog code={joinCode} onClose={() => setInvite(false)} />}
      <FilterTiles
        label="Filter drivers"
        value={query.state}
        onChange={(state) => set({ state: state === "all" ? null : state })}
        options={[
          { value: "all", label: "All drivers", count: c.all ?? 0, icon: Layers, color: "#133a8f" },
          { value: "active", label: "Active", count: c.active ?? 0, icon: UserCheck, color: "#15803d" },
          { value: "driving", label: "Driving now", count: c.driving ?? 0, icon: Navigation, color: "#15803d" },
          { value: "assigned", label: "With a vehicle", count: c.assigned ?? 0, icon: UserCheck, color: "#0f766e" },
          { value: "unassigned", label: "No vehicle", count: c.unassigned ?? 0, icon: Users, color: "#b45309" },
          { value: "license", label: "Licence due", count: c.license ?? 0, icon: BadgeAlert, color: "#b91c1c" },
          { value: "inactive", label: "Inactive", count: c.inactive ?? 0, icon: UserX, color: "#475569" }
        ]}
      />
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
          minWidth={760}
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
          <DriverRecordPanel driver={selected} canUpdate={can.update} onEdit={() => setForm({ driver: selected })} onClose={() => setSelectedId(null)} onChanged={refresh} />
        </div>
      )}
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
        title={`Delete ${deleting?.name ?? "driver"}?`}
        description="Removes the driver record. To keep their history, edit them and set them to Inactive instead."
        confirmLabel="Delete driver"
        destructive
        onConfirm={async () => {
          try {
            await api(`/api/drivers/${deleting!.id}`, { method: "DELETE" });
            toast.success("Driver deleted");
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

/** Drivers join with the company code (or the link that carries it). */
function InviteDriversDialog({ code, onClose }: { code: string; onClose: () => void }) {
  const link = typeof window === "undefined" ? `/signup?code=${encodeURIComponent(code)}` : `${window.location.origin}/signup?code=${encodeURIComponent(code)}`;
  const text = `Join our company on RIO GPS: ${link} (company code ${code})`;
  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy. Select the text and copy it.");
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Invite drivers" description="Drivers open the link (or type the code at Create account → I'm a driver). They're added to your Drivers list after confirming their phone." className="max-w-md">
        <div className="grid gap-3 px-5 py-4">
          <div className="grid justify-items-center gap-1 rounded-xl bg-muted/60 p-4 text-center">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Company code</span>
            <b className="text-2xl tracking-wider">{code}</b>
          </div>
          <div className="flex gap-2">
            <Input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
            <Button variant="secondary" onClick={() => void copy(link)}>
              Copy link
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <a className={buttonVariants({ variant: "secondary", size: "sm" })} href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
            <a className={buttonVariants({ variant: "secondary", size: "sm" })} href={`sms:?&body=${encodeURIComponent(text)}`}>
              Text message
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
