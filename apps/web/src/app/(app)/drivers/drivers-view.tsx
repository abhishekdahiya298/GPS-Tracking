"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { BadgeAlert, Car, History, IdCard, Layers, Map as MapIcon, Navigation, Pencil, Phone, Plus, Trash2, UserCheck, UserMinus, UserX, Users } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import type { DriverListQuery, DriverRow } from "@/lib/drivers";
import { asVehicleType, VEHICLE_TYPE_LABEL } from "@/lib/schemas/vehicle";
import { DriverFormDialog, type VehicleOption } from "./driver-form-dialog";

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
export function DriversView({ data, query, can, vehicles }: { data: Data; query: DriverListQuery; can: Can; vehicles: VehicleOption[] }) {
  const u = useUnits();
  const { set, refresh, pending } = useListParams();
  const [form, setForm] = useState<{ driver: DriverRow | null } | null>(null);
  const [deleting, setDeleting] = useState<DriverRow | null>(null);
  const [freeing, setFreeing] = useState<DriverRow | null>(null);
  const c = data.counts;
  const filtered = query.search !== "" || query.state !== "all";

  const columns = useMemo<ColumnDef<DriverRow, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Driver",
        meta: { sortKey: "name" } satisfies ColumnMeta,
        cell: ({ row: { original: d } }) => (
          <div className="flex min-w-0 items-center gap-3">
            <DriverAvatar name={d.name} />
            <div className="min-w-0">
              <p className="m-0 truncate font-medium text-foreground">{d.name}</p>
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
        header: "Vehicle",
        meta: { sortKey: "vehicle" } satisfies ColumnMeta,
        cell: ({ row: { original: d } }) =>
          d.vehicle ? (
            <Link href={`/vehicles?search=${encodeURIComponent(d.vehicle.name)}`} onClick={(e) => e.stopPropagation()} className="flex min-w-0 items-center gap-3 text-foreground no-underline hover:underline">
              <VehiclePicture type={d.vehicle.type} state={d.vehicle.moving ? "moving" : d.vehicle.deviceId ? "stopped" : undefined} className="h-9 w-12" />
              <span className="min-w-0">
                <span className="block truncate font-medium">{d.vehicle.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{[VEHICLE_TYPE_LABEL[asVehicleType(d.vehicle.type)], d.vehicle.licensePlate].filter(Boolean).join(" · ")}</span>
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
        cell: ({ row: { original: d } }) => {
          if (d.status === "inactive") return <span className="text-muted-foreground">Inactive</span>;
          if (!d.vehicle?.deviceId) return <span className="text-muted-foreground">—</span>;
          return d.vehicle.moving ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-[#15803d] dark:text-[#4ade80]">
              <Navigation className="size-3.5" aria-hidden="true" />
              Driving · {u.fmtSpeed(d.vehicle.speedKph ?? 0)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2 rounded-full bg-[#b91c1c]" aria-hidden="true" />
              Not driving{d.vehicle.lastSeenAt ? <> · <RelativeTime iso={d.vehicle.lastSeenAt} /></> : null}
            </span>
          );
        }
      },
      {
        id: "license",
        header: "Licence",
        meta: { sortKey: "license", hideable: true, label: "Licence" } satisfies ColumnMeta,
        cell: ({ row: { original: d } }) => {
          const days = licenseDays(d.licenseExpiresOn);
          return (
            <div className="min-w-0 text-sm">
              <div className="truncate font-mono text-xs text-muted-foreground">{d.licenseNumber ?? "—"}</div>
              {days != null && (
                <span
                  className={
                    days < 0
                      ? "text-xs font-semibold text-[#b91c1c]"
                      : days <= 30
                        ? "text-xs font-semibold text-[#c2410c]"
                        : "text-xs text-muted-foreground"
                  }
                >
                  {days < 0 ? `Expired ${d.licenseExpiresOn}` : days <= 30 ? `Expires in ${days} d` : `Valid to ${d.licenseExpiresOn}`}
                </span>
              )}
            </div>
          );
        }
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        meta: { className: "w-0 whitespace-nowrap text-right" } satisfies ColumnMeta,
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
    [can, u]
  );

  return (
    <>
      <PageHeader
        title="Drivers"
        description="Who drives which vehicle, and whether they are on the road now."
        actions={
          can.create && (
            <Button onClick={() => setForm({ driver: null })}>
              <Plus /> Add driver
            </Button>
          )
        }
      />
      <FilterTiles
        label="Filter drivers"
        value={query.state}
        onChange={(state) => set({ state: state === "all" ? null : state })}
        options={[
          { value: "all", label: "All drivers", count: c.all ?? 0, icon: Layers, color: "#133a8f" },
          { value: "driving", label: "Driving now", count: c.driving ?? 0, icon: Navigation, color: "#15803d" },
          { value: "assigned", label: "With a vehicle", count: c.assigned ?? 0, icon: UserCheck, color: "#0f766e" },
          { value: "unassigned", label: "No vehicle", count: c.unassigned ?? 0, icon: Users, color: "#b45309" },
          { value: "license", label: "Licence due", count: c.license ?? 0, icon: BadgeAlert, color: "#b91c1c" },
          { value: "inactive", label: "Inactive", count: c.inactive ?? 0, icon: UserX, color: "#475569" }
        ]}
      />
      <Card>
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
          onRowClick={can.update ? (d) => setForm({ driver: d }) : undefined}
          rowLabel={(d) => `Edit ${d.name}`}
          loading={pending}
          toolbar={<SearchInput value={query.search} onChange={(search) => set({ search })} placeholder="Search name, phone, licence or vehicle…" label="Search drivers" />}
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
