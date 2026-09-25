"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { Cpu, Link2, Link2Off, MoreHorizontal, Pencil, Power, PowerOff, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { DataTable, type ColumnMeta } from "@/components/app/data-table";
import { SegmentedFilter } from "@/components/app/filter-bar";
import { PageHeader } from "@/components/app/page-header";
import { SearchInput } from "@/components/app/search-input";
import { EmptyState } from "@/components/app/states";
import { StatusBadge, type StatusTone } from "@/components/app/status-badge";
import { useListParams } from "@/components/app/use-list-params";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import type { DeviceListQuery, DeviceRow, DeviceState, Page } from "@/lib/fleet-list";
import { relativeTime } from "@/lib/format";
import dynamic from "next/dynamic";

// Dialogs (and their form/validation code) load on first use, not with the page.
const AssignDialog = dynamic(() => import("../_fleet/assign-dialog").then((m) => m.AssignDialog));
const RenameDialog = dynamic(() => import("../_fleet/rename-device-dialog").then((m) => m.RenameDialog));

type Can = { manage: boolean; assign: boolean; unassign: boolean; superAdmin: boolean };

const STATE: Record<DeviceState, { label: string; tone: StatusTone }> = {
  online: { label: "Online", tone: "success" },
  offline: { label: "Offline", tone: "neutral" },
  never_seen: { label: "No data yet", tone: "neutral" },
  inactive: { label: "Deactivated", tone: "warning" },
  retired: { label: "Retired", tone: "neutral" }
};
const label = (d: DeviceRow) => d.name ?? d.model ?? "Device";

export function DevicesView({ data, query, can }: { data: Page<DeviceRow, DeviceState | "unassigned">; query: DeviceListQuery; can: Can }) {
  const { set, refresh, pending } = useListParams();
  const [renaming, setRenaming] = useState<DeviceRow | null>(null);
  const [toggling, setToggling] = useState<DeviceRow | null>(null);
  const [assignFor, setAssignFor] = useState<DeviceRow | null>(null);
  const [unassigning, setUnassigning] = useState<DeviceRow | null>(null);
  const c = data.counts;
  const filtered = query.search !== "" || query.state !== "all";

  const RowMenu = ({ d }: { d: DeviceRow }) => {
    const items = [
      can.manage && (
        <DropdownMenuItem key="rename" onSelect={() => setRenaming(d)}>
          <Pencil aria-hidden="true" /> Rename
        </DropdownMenuItem>
      ),
      can.assign && (
        <DropdownMenuItem key="assign" onSelect={() => setAssignFor(d)}>
          <Link2 aria-hidden="true" /> {d.vehicle ? "Move to another vehicle" : "Assign to vehicle"}
        </DropdownMenuItem>
      ),
      can.unassign && d.vehicle && (
        <DropdownMenuItem key="unassign" onSelect={() => setUnassigning(d)}>
          <Link2Off aria-hidden="true" /> Unassign
        </DropdownMenuItem>
      )
    ].filter(Boolean);
    const toggle = can.manage && d.state !== "retired";
    if (items.length === 0 && !toggle) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label={`Actions for ${label(d)}`} size="icon-sm">
            <MoreHorizontal aria-hidden="true" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {items}
          {toggle && (
            <>
              {items.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem destructive={d.status === "active"} onSelect={() => setToggling(d)}>
                {d.status === "active" ? <PowerOff aria-hidden="true" /> : <Power aria-hidden="true" />}
                {d.status === "active" ? "Deactivate" : "Reactivate"}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const columns = useMemo<ColumnDef<DeviceRow, unknown>[]>(
    () => [
      {
        id: "device",
        header: "Device",
        meta: { sortKey: "name" } satisfies ColumnMeta,
        cell: ({ row: { original: d } }) => (
          <div className="min-w-0">
            <p className="m-0 truncate font-medium text-foreground">{label(d)}</p>
            <p className="m-0 truncate text-xs text-muted-foreground">{[d.name && d.model ? d.model : null, d.imeiLast4 ? `IMEI …${d.imeiLast4}` : null].filter(Boolean).join(" · ") || " "}</p>
          </div>
        )
      },
      { id: "status", header: "Status", meta: { sortKey: "state" } satisfies ColumnMeta, cell: ({ row }) => <StatusBadge {...STATE[row.original.state]} /> },
      {
        id: "vehicle",
        header: "Vehicle",
        meta: { sortKey: "vehicle" } satisfies ColumnMeta,
        cell: ({ row: { original: d } }) => (d.vehicle ? <span>{d.vehicle.name}</span> : <span className="text-muted-foreground">Not assigned</span>)
      },
      {
        id: "lastSeen",
        header: "Last seen",
        meta: { sortKey: "lastSeen", hideable: true, label: "Last seen" } satisfies ColumnMeta,
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{relativeTime(row.original.lastSeenAt)}</span>
      },
      { id: "actions", header: () => <span className="sr-only">Actions</span>, meta: { className: "w-12 text-right" } satisfies ColumnMeta, cell: ({ row }) => <RowMenu d={row.original} /> }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can]
  );

  return (
    <>
      <PageHeader
        title="Devices"
        description="GPS trackers registered to your organization and the vehicle each one is on."
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
          loading={pending}
          toolbar={
            <>
              <SearchInput value={query.search} onChange={(search) => set({ search })} placeholder={can.manage ? "Search name, vehicle or IMEI digits…" : "Search name or vehicle…"} label="Search devices" />
              <SegmentedFilter
                label="Filter by status"
                value={query.state}
                onChange={(state) => set({ state: state === "all" ? null : state })}
                options={[
                  { value: "all", label: "All", count: c.all ?? 0 },
                  { value: "online", label: "Online", count: c.online ?? 0 },
                  { value: "offline", label: "Offline", count: c.offline ?? 0 },
                  { value: "unassigned", label: "Unassigned", count: c.unassigned ?? 0 },
                  { value: "inactive", label: "Deactivated", count: (c.inactive ?? 0) + (c.retired ?? 0) }
                ]}
              />
            </>
          }
          mobileRow={(d) => (
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate font-medium">{label(d)}</p>
                <p className="m-0 mt-0.5 truncate text-xs text-muted-foreground">
                  {[d.vehicle ? d.vehicle.name : "Not assigned", d.imeiLast4 ? `IMEI …${d.imeiLast4}` : null, relativeTime(d.lastSeenAt)].filter(Boolean).join(" · ")}
                </p>
                <div className="mt-1.5">
                  <StatusBadge {...STATE[d.state]} />
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
