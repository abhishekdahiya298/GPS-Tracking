"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { CircleStop, Clock, Cpu, MapPin, History, Layers, Navigation, Timer, Unplug, WifiOff, Link2, Link2Off, Map as MapIcon, MoreHorizontal, Pencil, Plus, RefreshCw, Share2, Trash2, Truck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { DataTable, type ColumnMeta } from "@/components/app/data-table";
import { DensityToggle, IgnitionDot, OrderBadge, PlateTag, useDensity, VinTag, yearMakeModel } from "@/components/app/vehicle-tags";
import { StatusChip } from "@/components/app/status-chip";
import { ACTION_COLOR, FilterTiles, RowActions } from "@/components/app/list-kit";
import { useAddress } from "@/lib/use-address";
import { DriverAvatar } from "../drivers/drivers-view";
import { PageHeader } from "@/components/app/page-header";
import { SearchInput } from "@/components/app/search-input";
import { EmptyState } from "@/components/app/states";
import { useListParams } from "@/components/app/use-list-params";
import { useUnits } from "@/components/app/units-context";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import type { GroupDto } from "@/lib/vehicle-groups";
import { api, errorMessage } from "@/lib/client/api";
import type { Page, VehicleListQuery, VehicleRow, VehicleState } from "@/lib/fleet-list";
import { relativeTime } from "@/lib/format";
import { RelativeTime } from "@/components/app/local-time";
import { useTime } from "@/components/app/time-context";
import dynamic from "next/dynamic";
import { pictureState, VehiclePicture } from "@/components/app/vehicle-picture";
import { asVehicleType, VEHICLE_TYPE_LABEL } from "@/lib/schemas/vehicle";
import type { EditableVehicle } from "../_fleet/vehicle-form-dialog";

// Drawer and dialogs (with their form/validation code) load on first use, not with the page.
const AssignDialog = dynamic(() => import("../_fleet/assign-dialog").then((m) => m.AssignDialog));
const ShareDialog = dynamic(() => import("./share-dialog").then((m) => m.ShareDialog));
const GroupsDialog = dynamic(() => import("./groups-dialog").then((m) => m.GroupsDialog));
const VehicleFormDialog = dynamic(() => import("../_fleet/vehicle-form-dialog").then((m) => m.VehicleFormDialog));
import { VehicleStateBadge } from "../_fleet/vehicle-state";
import { deviceDisplayName } from "@/lib/device-name";

/** Full street address (or coordinates while it loads) with a pin; wraps to a second line when long. */
function LocationCell({ lat, lon, moving }: { lat: number; lon: number; moving: boolean }) {
  const a = useAddress(lat, lon, moving);
  const text = a ? [a.line1, a.line2].filter(Boolean).join(", ") : `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  return (
    <span className="flex min-w-0 items-start gap-1 text-xs leading-4 text-foreground/80" title={a?.label ?? text}>
      <MapPin className="mt-px size-3.5 shrink-0 text-[#2563eb]" aria-hidden="true" />
      <span className="line-clamp-2 [overflow-wrap:anywhere]">{text}</span>
    </span>
  );
}

/** States whose last reading is old: no live speed is shown for them. */
const SILENT = new Set<string>(["offline", "never_seen", "inactive", "parked"]);

type Can = { create: boolean; update: boolean; remove: boolean; assign: boolean; unassign: boolean; map: boolean };

export function VehiclesView({ data, query, can, groups }: { data: Page<VehicleRow, VehicleState>; query: VehicleListQuery; can: Can; groups: GroupDto[] }) {
  const u = useUnits();
  const t = useTime();
  const router = useRouter();
  const { set, refresh, pending } = useListParams();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EditableVehicle | null>(null);
  const [assignFor, setAssignFor] = useState<VehicleRow | null>(null);
  const [deleting, setDeleting] = useState<VehicleRow | null>(null);
  const [unassigning, setUnassigning] = useState<VehicleRow | null>(null);
  const c = data.counts;
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [sharing, setSharing] = useState<VehicleRow | null>(null);
  const filtered = query.search !== "" || query.state !== "all" || !!query.group;

  const [density, setDensity] = useDensity("vehicles");
  const openEdit = (v: Pick<VehicleRow, "id" | "name" | "licensePlate" | "type" | "vehicleStatus">) => {
    setEditing({ id: v.id, name: v.name, licensePlate: v.licensePlate, type: v.type, vehicleStatus: v.vehicleStatus });
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
        <DropdownMenuItem asChild>
          <Link href={`/vehicles/${v.id}`}>
            <Truck aria-hidden="true" /> Vehicle details
          </Link>
        </DropdownMenuItem>
        {can.map && v.device && v.location && (
          <DropdownMenuItem asChild>
            <Link href={`/map?focus=${v.device.id}`}>
              <MapIcon aria-hidden="true" /> Show on map
            </Link>
          </DropdownMenuItem>
        )}
        {can.update && can.map && (
          <DropdownMenuItem onSelect={() => setSharing(v)}>
            <Share2 aria-hidden="true" /> Share live location
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
        meta: { sortKey: "name", width: "31%" } satisfies ColumnMeta,
        cell: ({ row: { original: v } }) => {
          const ymm = yearMakeModel(v);
          return (
            <div className="flex min-w-0 items-center gap-2.5">
              <VehiclePicture type={v.type} state={pictureState(v.device ? v.state : null)} className={density === "compact" ? "h-8 w-12" : "h-10 w-14"} />
              <div className="grid min-w-0 gap-0.5">
                <p className="m-0 flex min-w-0 items-baseline gap-1.5 whitespace-nowrap" title={[v.name, ymm, ...v.groups].filter(Boolean).join(" · ")}>
                  <span className="font-semibold text-foreground">{v.name}</span>
                  <OrderBadge order={v.sortOrder} className="self-center" />
                  {ymm && <span className="truncate text-xs text-muted-foreground">{ymm}</span>}
                </p>
                <p className="m-0 flex flex-wrap items-center gap-1">
                  <PlateTag plate={v.licensePlate} />
                  <VinTag vin={v.vin} />
                  {!v.licensePlate && !v.vin && <span className="text-xs text-muted-foreground">{VEHICLE_TYPE_LABEL[asVehicleType(v.type)]}</span>}
                </p>
              </div>
            </div>
          );
        }
      },
      {
        id: "status",
        header: "Status · speed",
        meta: { sortKey: "state", width: "18%" } satisfies ColumnMeta,
        // A silent tracker's last speed is history, not now: speed only shows while it's moving and reporting.
        cell: ({ row: { original: v } }) => {
          const live = v.location && !SILENT.has(v.state);
          return (
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusChip status={v.state} label={v.state === "moving" && live ? `Moving · ${u.fmtSpeed(v.location!.speedKph)}` : undefined} />
              {live && <IgnitionDot ignition={v.location!.ignition} />}
            </div>
          );
        }
      },
      {
        id: "driver",
        header: "Driver · location",
        meta: { hideable: true, label: "Driver and location", width: "29%" } satisfies ColumnMeta,
        cell: ({ row: { original: v } }) => (
          <div className="grid min-w-0 gap-0.5">
            {v.driver ? (
              <Link href={`/drivers?search=${encodeURIComponent(v.driver.name)}`} onClick={(e) => e.stopPropagation()} className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-foreground no-underline hover:underline">
                <DriverAvatar name={v.driver.name} className="size-5 text-[9px]" />
                <span className="truncate">{v.driver.name}</span>
              </Link>
            ) : (
              <span className="text-xs text-muted-foreground">No driver</span>
            )}
            {v.location ? <LocationCell lat={v.location.latitude} lon={v.location.longitude} moving={v.state === "moving"} /> : <span className="text-xs text-muted-foreground">{v.device ? "No position yet" : "No GPS device"}</span>}
          </div>
        )
      },
      {
        id: "lastSeen",
        header: "Last seen",
        meta: { sortKey: "lastSeen", hideable: true, label: "Last seen", width: "10%" } satisfies ColumnMeta,
        cell: ({ row: { original: v } }) => (
          <div className="grid min-w-0 gap-0.5">
            <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-foreground">
              <Clock className="size-3.5 shrink-0 text-[#64748b]" aria-hidden="true" />
              {v.device ? <RelativeTime iso={v.lastSeenAt} /> : "—"}
            </span>
            <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground" title={v.device ? deviceDisplayName(v.device.name, v.device.model) : "No GPS device"}>
              <Cpu className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{v.device ? deviceDisplayName(v.device.name, v.device.model) : "No device"}</span>
            </span>
          </div>
        )
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        meta: { className: "whitespace-nowrap text-right", width: "12%" } satisfies ColumnMeta,
        // The common actions one click away (each in its own colour); the rest stay in the ⋯ menu.
        cell: ({ row: { original: v } }) => (
          <RowActions
            actions={[
              { icon: MapIcon, label: `Show ${v.name} on the map`, color: ACTION_COLOR.map, href: v.device ? `/map?focus=${v.device.id}` : undefined, hidden: !can.map || !v.device || !v.location },
              { icon: History, label: `${v.name}: trip history`, color: ACTION_COLOR.history, href: v.device ? `/map?trips=${v.device.id}` : undefined, hidden: !can.map || !v.device || !v.location },
              { icon: Pencil, label: `Edit ${v.name}`, color: ACTION_COLOR.edit, onClick: () => openEdit(v), hidden: !can.update },
              { icon: Link2, label: `Assign a device to ${v.name}`, color: ACTION_COLOR.link, onClick: () => setAssignFor(v), hidden: !can.assign || !!v.device }
            ]}
          >
            <RowMenu v={v} />
          </RowActions>
        )
      }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [u, can, density, router]
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
            {can.update && (
              <Button variant="secondary" onClick={() => setGroupsOpen(true)}>
                <Layers aria-hidden="true" /> Groups
              </Button>
            )}
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
      <FilterTiles
        label="Filter by status"
        value={query.state}
        onChange={(state) => set({ state: state === "all" ? null : state })}
        options={[
          { value: "all", label: "All vehicles", count: c.all ?? 0, icon: Layers, color: "#133a8f" },
          { value: "moving", label: "Moving", count: c.moving ?? 0, icon: Navigation, color: "#15803d" },
          { value: "idle", label: "Idling", count: c.idle ?? 0, icon: Timer, color: "#c2410c" },
          { value: "stopped", label: "Stopped", count: (c.stopped ?? 0) + (c.parked ?? 0), icon: CircleStop, color: "#b91c1c" },
          { value: "offline", label: "Offline", count: (c.offline ?? 0) + (c.never_seen ?? 0) + (c.inactive ?? 0), icon: WifiOff, color: "#64748b" },
          { value: "no_device", label: "No device", count: c.no_device ?? 0, icon: Unplug, color: "#0369a1" }
        ]}
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
          onPageSize={(pageSize) => set({ pageSize })}
          onRowClick={(v) => router.push(`/vehicles/${v.id}`)}
          rowLabel={(v) => `Open ${v.name}`}
          loading={pending}
          layout="fixed"
          minWidth={1000}
          density={density}
          toolbar={
            <>
              <SearchInput value={query.search} onChange={(search) => set({ search })} placeholder="Search name, plate, VIN, driver…" label="Search vehicles" />
              <Select
                aria-label="Sort vehicles"
                className="w-auto min-w-[12rem]"
                value={`${query.sort}:${query.direction}`}
                onChange={(e) => {
                  const [sort, direction] = e.target.value.split(":");
                  set({ sort: sort!, direction: direction! });
                }}
              >
                <option value="order:asc">Sort: Your order, then moving</option>
                <option value="state:asc">Sort: Moving first</option>
                <option value="lastSeen:desc">Sort: Recently active</option>
                <option value="speed:desc">Sort: Fastest first</option>
                <option value="name:asc">Sort: Name A–Z</option>
                <option value="name:desc">Sort: Name Z–A</option>
                <option value="plate:asc">Sort: Plate</option>
                <option value="lastSeen:asc">Sort: Longest silent</option>
              </Select>
              {groups.length > 0 && (
                <Select aria-label="Filter by group" className="w-auto min-w-[10rem] max-w-[14rem]" value={query.group ?? ""} onChange={(e) => set({ group: e.target.value || null })}>
                  <option value="">All groups</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.vehicleIds.length})
                    </option>
                  ))}
                </Select>
              )}
              <span className="hidden flex-1 md:block" />
              <DensityToggle value={density} onChange={setDensity} />
            </>
          }
          mobileRow={(v) => (
            <div className="flex items-start gap-3">
              <VehiclePicture type={v.type} state={pictureState(v.device ? v.state : null)} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate font-medium text-foreground">{v.name}</p>
                <p className="m-0 mt-0.5 truncate text-xs text-muted-foreground">
                  {[v.licensePlate, v.device ? deviceDisplayName(v.device.name, v.device.model) : "No device", v.location && !SILENT.has(v.state) ? u.fmtSpeed(v.location.speedKph) : null, v.device ? relativeTime(v.lastSeenAt, Date.now(), t.timeZone) : null].filter(Boolean).join(" · ")}
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
              <EmptyState title="No vehicles match" description="Try a different search or filter." action={<Button variant="secondary" onClick={() => set({ search: null, state: null, group: null })}>Clear filters</Button>} />
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

      {formOpen && <VehicleFormDialog open={formOpen} onOpenChange={setFormOpen} vehicle={editing} onSaved={refresh} />}
      {assignFor && (
        <AssignDialog open onOpenChange={(o) => !o && setAssignFor(null)} mode="device" fixedId={assignFor.id} title={`Assign a device to ${assignFor.name}`} onDone={refresh} />
      )}
      {sharing && <ShareDialog vehicle={{ id: sharing.id, name: sharing.name, hasDevice: sharing.device !== null }} onClose={() => setSharing(null)} />}
      {groupsOpen && (
        <GroupsDialog
          open
          onOpenChange={setGroupsOpen}
          groups={groups}
          onChanged={refresh}
        />
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
