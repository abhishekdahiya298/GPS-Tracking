"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { Link2, Link2Off, Map as MapIcon, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2, Truck } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { DataTable, type ColumnMeta } from "@/components/app/data-table";
import { SegmentedFilter } from "@/components/app/filter-bar";
import { PageHeader } from "@/components/app/page-header";
import { SearchInput } from "@/components/app/search-input";
import { EmptyState } from "@/components/app/states";
import { useListParams } from "@/components/app/use-list-params";
import { useUnits } from "@/components/app/units-context";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import type { Page, VehicleListQuery, VehicleRow, VehicleState } from "@/lib/fleet-list";
import { relativeTime } from "@/lib/format";
import dynamic from "next/dynamic";
import type { EditableVehicle } from "../_fleet/vehicle-form-dialog";

// Drawer and dialogs (with their form/validation code) load on first use, not with the page.
const AssignDialog = dynamic(() => import("../_fleet/assign-dialog").then((m) => m.AssignDialog));
const VehicleDetailSheet = dynamic(() => import("../_fleet/vehicle-detail-sheet").then((m) => m.VehicleDetailSheet));
const VehicleFormDialog = dynamic(() => import("../_fleet/vehicle-form-dialog").then((m) => m.VehicleFormDialog));
import { VehicleStateBadge } from "../_fleet/vehicle-state";

type Can = { create: boolean; update: boolean; remove: boolean; assign: boolean; unassign: boolean; map: boolean };

export function VehiclesView({ data, query, can }: { data: Page<VehicleRow, VehicleState>; query: VehicleListQuery; can: Can }) {
  const u = useUnits();
  const { set, refresh, pending } = useListParams();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EditableVehicle | null>(null);
  const [assignFor, setAssignFor] = useState<VehicleRow | null>(null);
  const [deleting, setDeleting] = useState<VehicleRow | null>(null);
  const [unassigning, setUnassigning] = useState<VehicleRow | null>(null);
  const c = data.counts;
  const filtered = query.search !== "" || query.state !== "all";

  const openEdit = (v: VehicleRow) => {
    setEditing({ id: v.id, name: v.name, licensePlate: v.licensePlate, vehicleStatus: v.vehicleStatus });
    setFormOpen(true);
  };

  const RowMenu = ({ v }: { v: VehicleRow }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={`Actions for ${v.name}`} size="icon-sm">
          <MoreHorizontal aria-hidden="true" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => setDetailId(v.id)}>
          <Truck aria-hidden="true" /> View details
        </DropdownMenuItem>
        {can.map && v.device && v.location && (
          <DropdownMenuItem asChild>
            <Link href={`/map?focus=${v.device.id}`}>
              <MapIcon aria-hidden="true" /> Show on map
            </Link>
          </DropdownMenuItem>
        )}
        {can.update && (
          <DropdownMenuItem onSelect={() => openEdit(v)}>
            <Pencil aria-hidden="true" /> Edit
          </DropdownMenuItem>
        )}
        {can.assign && (
          <DropdownMenuItem onSelect={() => setAssignFor(v)}>
            <Link2 aria-hidden="true" /> {v.device ? "Change device" : "Assign device"}
          </DropdownMenuItem>
        )}
        {can.unassign && v.device && (
          <DropdownMenuItem onSelect={() => setUnassigning(v)}>
            <Link2Off aria-hidden="true" /> Unassign device
          </DropdownMenuItem>
        )}
        {can.remove && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => setDeleting(v)}>
              <Trash2 aria-hidden="true" /> Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const columns = useMemo<ColumnDef<VehicleRow, unknown>[]>(
    () => [
      {
        id: "vehicle",
        header: "Vehicle",
        meta: { sortKey: "name" } satisfies ColumnMeta,
        cell: ({ row: { original: v } }) => (
          <div className="min-w-0">
            <p className="m-0 truncate font-medium text-foreground">{v.name}</p>
            {v.licensePlate && <p className="m-0 truncate text-xs text-muted-foreground">{v.licensePlate}</p>}
          </div>
        )
      },
      { id: "status", header: "Status", meta: { sortKey: "state" } satisfies ColumnMeta, cell: ({ row }) => <VehicleStateBadge state={row.original.state} /> },
      {
        id: "device",
        header: "Device",
        meta: { hideable: true, label: "Device" } satisfies ColumnMeta,
        cell: ({ row: { original: v } }) => (v.device ? <span className="text-foreground">{v.device.name ?? v.device.model ?? "Device"}</span> : <span className="text-muted-foreground">—</span>)
      },
      {
        id: "speed",
        header: "Speed",
        meta: { sortKey: "speed", hideable: true, label: "Speed", className: "text-right tabular-nums" } satisfies ColumnMeta,
        cell: ({ row: { original: v } }) => (v.location ? u.fmtSpeed(v.location.speedKph) : "—")
      },
      {
        id: "ignition",
        header: "Ignition",
        meta: { hideable: true, label: "Ignition" } satisfies ColumnMeta,
        cell: ({ row: { original: v } }) => (v.location?.ignition === true ? "On" : v.location?.ignition === false ? "Off" : "—")
      },
      {
        id: "lastSeen",
        header: "Last seen",
        meta: { sortKey: "lastSeen", hideable: true, label: "Last seen" } satisfies ColumnMeta,
        cell: ({ row: { original: v } }) => <span className="whitespace-nowrap text-muted-foreground">{v.device ? relativeTime(v.lastSeenAt) : "—"}</span>
      },
      { id: "actions", header: () => <span className="sr-only">Actions</span>, meta: { className: "w-12 text-right" } satisfies ColumnMeta, cell: ({ row }) => <RowMenu v={row.original} /> }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [u, can]
  );

  return (
    <>
      <PageHeader
        title="Vehicles"
        description="Every vehicle in your fleet, its GPS device and live status."
        actions={
          <>
            <IconButton label="Refresh" variant="secondary" onClick={refresh} disabled={pending}>
              <RefreshCw className={pending ? "animate-spin" : undefined} aria-hidden="true" />
            </IconButton>
            {can.create && (
              <Button
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <Plus aria-hidden="true" /> Add vehicle
              </Button>
            )}
          </>
        }
      />
      <Card>
        <DataTable
          columns={columns}
          data={data.items}
          getRowId={(v) => v.id}
          total={data.total}
          page={data.page}
          pageSize={data.pageSize}
          sort={query.sort}
          direction={query.direction}
          onSort={(sort, direction) => set({ sort, direction })}
          onPage={(page) => set({ page })}
          onRowClick={(v) => setDetailId(v.id)}
          rowLabel={(v) => `Open ${v.name}`}
          loading={pending}
          toolbar={
            <>
              <SearchInput value={query.search} onChange={(search) => set({ search })} placeholder="Search name, plate or device…" label="Search vehicles" />
              <SegmentedFilter
                label="Filter by status"
                value={query.state}
                onChange={(state) => set({ state: state === "all" ? null : state })}
                options={[
                  { value: "all", label: "All", count: c.all ?? 0 },
                  { value: "moving", label: "Moving", count: c.moving ?? 0 },
                  { value: "idle", label: "Idle", count: c.idle ?? 0 },
                  { value: "offline", label: "Offline", count: (c.offline ?? 0) + (c.never_seen ?? 0) + (c.inactive ?? 0) },
                  { value: "no_device", label: "No device", count: c.no_device ?? 0 }
                ]}
              />
            </>
          }
          mobileRow={(v) => (
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate font-medium text-foreground">{v.name}</p>
                <p className="m-0 mt-0.5 truncate text-xs text-muted-foreground">
                  {[v.licensePlate, v.device ? (v.device.name ?? v.device.model) : "No device", v.location ? u.fmtSpeed(v.location.speedKph) : null, v.device ? relativeTime(v.lastSeenAt) : null].filter(Boolean).join(" · ")}
                </p>
                <div className="mt-1.5">
                  <VehicleStateBadge state={v.state} />
                </div>
              </div>
              <RowMenu v={v} />
            </div>
          )}
          empty={
            filtered ? (
              <EmptyState title="No vehicles match" description="Try a different search or filter." action={<Button variant="secondary" onClick={() => set({ search: null, state: null })}>Clear filters</Button>} />
            ) : (
              <EmptyState
                icon={Truck}
                title="No vehicles yet"
                description="Add a vehicle and assign a GPS device to start tracking it."
                action={can.create ? <Button onClick={() => { setEditing(null); setFormOpen(true); }}><Plus aria-hidden="true" /> Add vehicle</Button> : undefined}
              />
            )
          }
        />
      </Card>

      {detailId && <VehicleDetailSheet
        vehicleId={detailId}
        onOpenChange={(o) => !o && setDetailId(null)}
        actions={(d) =>
          can.update ? (
            <Button size="sm" variant="secondary" onClick={() => { setDetailId(null); openEdit({ id: d.vehicle.id, name: d.vehicle.name, licensePlate: d.vehicle.licensePlate, vehicleStatus: d.vehicle.status } as VehicleRow); }}>
              <Pencil aria-hidden="true" /> Edit
            </Button>
          ) : null
        }
      />}
      {formOpen && <VehicleFormDialog open={formOpen} onOpenChange={setFormOpen} vehicle={editing} onSaved={refresh} />}
      {assignFor && (
        <AssignDialog open onOpenChange={(o) => !o && setAssignFor(null)} mode="device" fixedId={assignFor.id} title={`Assign a device to ${assignFor.name}`} onDone={refresh} />
      )}
      <ConfirmDialog
        open={unassigning !== null}
        onOpenChange={(o) => !o && setUnassigning(null)}
        title={`Unassign the device from ${unassigning?.name ?? ""}?`}
        description="New positions from this device will no longer be linked to the vehicle. Recorded history stays."
        confirmLabel="Unassign"
        onConfirm={async () => {
          try {
            await api(`/api/devices/${unassigning!.device!.id}/assignment`, { method: "DELETE" });
            toast.success("Device unassigned.");
            refresh();
          } catch (err) {
            toast.error(errorMessage(err));
            throw err;
          }
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "vehicle"}?`}
        description="This can't be undone. Vehicles with recorded history can't be deleted; set them to Inactive instead."
        confirmLabel="Delete vehicle"
        destructive
        onConfirm={async () => {
          try {
            await api(`/api/vehicles/${deleting!.id}`, { method: "DELETE" });
            toast.success("Vehicle deleted.");
            refresh();
          } catch (err) {
            toast.error(errorMessage(err));
            throw err;
          }
        }}
      />
    </>
  );
}
