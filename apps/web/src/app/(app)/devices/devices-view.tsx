"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { CircleOff, Clock, Cpu, Layers, Link2, Link2Off, Pencil, Power, PowerOff, Radio, RefreshCw, Unplug, UserRound, WifiOff } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { DataTable, type ColumnMeta } from "@/components/app/data-table";
import { FilterTiles, IconCell, RowActions } from "@/components/app/list-kit";
import { pictureState, VehiclePicture } from "@/components/app/vehicle-picture";
import { PageHeader } from "@/components/app/page-header";
import { SearchInput } from "@/components/app/search-input";
import { EmptyState } from "@/components/app/states";
import { StatusChip } from "@/components/app/status-chip";
type StatusTone = "success" | "neutral" | "warning";
import { useListParams } from "@/components/app/use-list-params";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import type { DeviceListQuery, DeviceRow, DeviceState, Page } from "@/lib/fleet-list";
import { relativeTime } from "@/lib/format";
import { RelativeTime } from "@/components/app/local-time";
import { useTime } from "@/components/app/time-context";
import dynamic from "next/dynamic";
import { deviceDisplayName, productName } from "@/lib/device-name";
import { asVehicleType, VEHICLE_TYPE_LABEL } from "@/lib/schemas/vehicle";

// Dialogs (and their form/validation code) load on first use, not with the page.
const AssignDialog = dynamic(() => import("../_fleet/assign-dialog").then((m) => m.AssignDialog));
const RenameDialog = dynamic(() => import("../_fleet/rename-device-dialog").then((m) => m.RenameDialog));

type Can = { manage: boolean; assign: boolean; unassign: boolean; superAdmin: boolean };

const STATE: Record<DeviceState, { label: string; tone: StatusTone }> = {
  online: { label: "Online", tone: "success" },
  offline: { label: "No signal", tone: "neutral" },
  never_seen: { label: "No data yet", tone: "neutral" },
  inactive: { label: "Deactivated", tone: "warning" },
  retired: { label: "Retired", tone: "neutral" }
};
const label = (d: DeviceRow) => deviceDisplayName(d.name, d.model);
const STATE_COLOR: Record<DeviceState, string> = { online: "#15803d", offline: "#64748b", never_seen: "#b45309", inactive: "#c2410c", retired: "#475569" };

export function DevicesView({ data, query, can, supportEmail = "support@riogps.com" }: { data: Page<DeviceRow, DeviceState | "unassigned">; query: DeviceListQuery; can: Can; supportEmail?: string }) {
  const t = useTime();
  const { set, refresh, pending } = useListParams();
  const [renaming, setRenaming] = useState<DeviceRow | null>(null);
  const [toggling, setToggling] = useState<DeviceRow | null>(null);
  const [assignFor, setAssignFor] = useState<DeviceRow | null>(null);
  const [unassigning, setUnassigning] = useState<DeviceRow | null>(null);
  const c = data.counts;
  const filtered = query.search !== "" || query.state !== "all";

  const RowMenu = ({ d }: { d: DeviceRow }) => (
    <RowActions
      actions={[
        { icon: Pencil, label: "Rename", onClick: () => setRenaming(d), hidden: !can.manage },
        { icon: Link2, label: d.vehicle ? "Move to another vehicle" : "Assign to a vehicle", onClick: () => setAssignFor(d), hidden: !can.assign },
        { icon: Link2Off, label: "Unassign from vehicle", onClick: () => setUnassigning(d), hidden: !can.unassign || !d.vehicle },
        { icon: d.status === "active" ? PowerOff : Power, label: d.status === "active" ? "Deactivate" : "Reactivate", onClick: () => setToggling(d), tone: d.status === "active" ? "danger" : undefined, hidden: !can.manage || d.state === "retired" }
      ]}
    />
  );

  const columns = useMemo<ColumnDef<DeviceRow, unknown>[]>(
    () => [
      {
        id: "device",
        header: "Device",
        meta: { sortKey: "name" } satisfies ColumnMeta,
        cell: ({ row: { original: d } }) => (
          <IconCell
            icon={Cpu}
            color={STATE_COLOR[d.state]}
            title={label(d)}
            lines={[[label(d) !== productName(d.model) ? productName(d.model) : null, d.imeiLast4 ? `IMEI …${d.imeiLast4}` : null].filter(Boolean).join(" · ") || null]}
          />
        )
      },
      { id: "status", header: "Status", meta: { sortKey: "state" } satisfies ColumnMeta, cell: ({ row }) => <StatusChip status={row.original.state} label={STATE[row.original.state].label} /> },
      {
        id: "vehicle",
        header: "Vehicle · driver",
        meta: { sortKey: "vehicle" } satisfies ColumnMeta,
        cell: ({ row: { original: d } }) =>
          d.vehicle ? (
            <Link href={`/map?focus=${d.id}`} onClick={(e) => e.stopPropagation()} className="flex min-w-0 items-center gap-3 text-foreground no-underline hover:underline">
              <VehiclePicture type={d.vehicle.type} state={pictureState(d.state === "online" ? "moving" : d.state)} className="h-9 w-12" />
              <span className="min-w-0">
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="truncate font-medium">{d.vehicle.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{[VEHICLE_TYPE_LABEL[asVehicleType(d.vehicle.type)], d.vehicle.licensePlate].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-1 truncate text-xs">
                  {d.driver ? (
                    <>
                      <UserRound className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                      <span className="truncate font-medium text-foreground">{d.driver.name}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">No driver</span>
                  )}
                </span>
              </span>
            </Link>
          ) : can.assign ? (
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setAssignFor(d);
              }}
            >
              <Link2 /> Assign to vehicle
            </Button>
          ) : (
            <span className="text-muted-foreground">Not assigned</span>
          )
      },
      {
        id: "lastSeen",
        header: "Last seen",
        meta: { sortKey: "lastSeen", hideable: true, label: "Last seen" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-muted-foreground">
            <Clock className="size-3.5" aria-hidden="true" />
            <RelativeTime iso={row.original.lastSeenAt} />
          </span>
        )
      },
      { id: "actions", header: () => <span className="sr-only">Actions</span>, meta: { className: "w-0 whitespace-nowrap text-right" } satisfies ColumnMeta, cell: ({ row }) => <RowMenu d={row.original} /> }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can]
  );

  return (
    <>
      <PageHeader
        title="GPS devices"
        description={`${data.counts.all ?? 0} RIO GPS tracker${data.counts.all === 1 ? "" : "s"}${data.counts.unassigned ? ` · ${data.counts.unassigned} not on a vehicle` : " · all on a vehicle"}`}
        actions={
          <>
            <IconButton label="Refresh" variant="secondary" onClick={refresh} disabled={pending}>
              <RefreshCw className={pending ? "animate-spin" : undefined} aria-hidden="true" />
            </IconButton>
            {can.superAdmin && (
              <Button asChild>
                <Link href="/admin/customers">Register device</Link>
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
          { value: "all", label: "All devices", count: c.all ?? 0, icon: Layers, color: "#133a8f" },
          { value: "online", label: "Online", count: c.online ?? 0, icon: Radio, color: "#15803d" },
          { value: "offline", label: "No signal", count: c.offline ?? 0, icon: WifiOff, color: "#64748b" },
          { value: "unassigned", label: "Not on a vehicle", count: c.unassigned ?? 0, icon: Unplug, color: "#b45309" },
          { value: "inactive", label: "Deactivated", count: (c.inactive ?? 0) + (c.retired ?? 0), icon: CircleOff, color: "#c2410c" }
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
          loading={pending}
          toolbar={
            <>
              <SearchInput value={query.search} onChange={(search) => set({ search })} placeholder={can.manage ? "Search name, vehicle or IMEI digits…" : "Search name or vehicle…"} label="Search devices" />
            </>
          }
          mobileRow={(d) => (
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate font-medium">{label(d)}</p>
                <p className="m-0 mt-0.5 truncate text-xs text-muted-foreground" suppressHydrationWarning>
                  {[d.vehicle ? d.vehicle.name : "Not assigned", d.imeiLast4 ? `IMEI …${d.imeiLast4}` : null, relativeTime(d.lastSeenAt, Date.now(), t.timeZone)].filter(Boolean).join(" · ")}
                </p>
                <div className="mt-1.5">
                  <StatusChip status={d.state} label={STATE[d.state].label} />
                </div>
              </div>
              <RowMenu d={d} />
            </div>
          )}
          empty={
            filtered ? (
              <EmptyState title="No devices match" description="Try a different search or filter." action={<Button variant="secondary" onClick={() => set({ search: null, state: null })}>Clear filters</Button>} />
            ) : (
              <EmptyState icon={Cpu} title="No devices yet" description="GPS trackers are registered to your account by RIO. Once registered, assign each one to a vehicle." />
            )
          }
        />
      </Card>
      <p className="m-0 mt-3 text-xs text-muted-foreground">New trackers are registered to your account by RIO GPS. Need another one? <a href={`mailto:${supportEmail}`} className="text-primary">Contact support</a>.</p>

      {renaming && <RenameDialog device={renaming} onClose={() => setRenaming(null)} onSaved={refresh} />}
      {assignFor && <AssignDialog open onOpenChange={(o) => !o && setAssignFor(null)} mode="vehicle" fixedId={assignFor.id} title={`Assign ${label(assignFor)} to a vehicle`} onDone={refresh} />}
      <ConfirmDialog
        open={unassigning !== null}
        onOpenChange={(o) => !o && setUnassigning(null)}
        title={`Unassign ${unassigning ? label(unassigning) : ""}?`}
        description="New positions will no longer be linked to a vehicle. Recorded history stays."
        confirmLabel="Unassign"
        onConfirm={async () => {
          try {
            await api(`/api/devices/${unassigning!.id}/assignment`, { method: "DELETE" });
            toast.success("Device unassigned.");
            refresh();
          } catch (err) {
            toast.error(errorMessage(err));
            throw err;
          }
        }}
      />
      <ConfirmDialog
        open={toggling !== null}
        onOpenChange={(o) => !o && setToggling(null)}
        title={toggling?.status === "active" ? `Deactivate ${toggling ? label(toggling) : ""}?` : `Reactivate ${toggling ? label(toggling) : ""}?`}
        description={toggling?.status === "active" ? "Its positions stop being recorded, and it disappears from the live map and alerts, until you reactivate it. History stays." : "Positions will be recorded again from the next report."}
        confirmLabel={toggling?.status === "active" ? "Deactivate" : "Reactivate"}
        destructive={toggling?.status === "active"}
        onConfirm={async () => {
          try {
            await api(`/api/devices/${toggling!.id}`, { method: "PATCH", json: { active: toggling!.status !== "active" } });
            toast.success(toggling!.status === "active" ? "Device deactivated." : "Device reactivated.");
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
