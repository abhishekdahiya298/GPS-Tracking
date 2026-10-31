"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { Cpu } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { DataTable, type ColumnMeta } from "@/components/app/data-table";
import { SegmentedFilter } from "@/components/app/filter-bar";
import { RelativeTime } from "@/components/app/local-time";
import { PageHeader } from "@/components/app/page-header";
import { SearchInput } from "@/components/app/search-input";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { useListParams } from "@/components/app/use-list-params";
import { Card } from "@/components/ui/card";
import type { PlatformTrackerQuery, PlatformTrackerRow } from "@/lib/platform";
import { useRouter } from "next/navigation";

type Data = { items: PlatformTrackerRow[]; total: number; page: number; pageSize: number; counts: Record<PlatformTrackerQuery["state"], number> };

const DAY = 86_400_000;

function connectivity(t: PlatformTrackerRow, now: number, onlineMs: number) {
  if (t.status !== "active") return <StatusBadge tone="neutral" label={t.status === "retired" ? "Retired" : "Deactivated"} />;
  if (!t.lastSeenAt) return <StatusBadge tone="warning" label="Never reported" />;
  const age = now - new Date(t.lastSeenAt).getTime();
  if (age > DAY) return <StatusBadge tone="warning" label="Silent 24 h+" />;
  if (age > onlineMs) return <StatusBadge tone="neutral" label="Offline" />;
  return <StatusBadge tone="success" label="Online" />;
}

/** Every tracker on the platform, with its customer: find a unit by IMEI digits and spot silent ones. */
export function TrackersView({ data, query, onlineSeconds }: { data: Data; query: PlatformTrackerQuery; onlineSeconds: number }) {
  const router = useRouter();
  const { set, pending } = useListParams();
  const now = Date.now();
  const columns = useMemo<ColumnDef<PlatformTrackerRow, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Tracker",
        meta: { sortKey: "name" } as ColumnMeta,
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="font-medium">{row.original.name ?? row.original.model ?? "Tracker"}</div>
            <div className="text-xs text-muted-foreground">
              {row.original.model ?? "—"} · IMEI …{row.original.imeiLast4}
            </div>
          </div>
        )
      },
      {
        id: "customer",
        header: "Customer",
        meta: { sortKey: "customer" } as ColumnMeta,
        cell: ({ row }) => (
          <span className="flex flex-wrap items-center gap-1.5">
            <Link href={`/admin/customers/${row.original.customerId}`} onClick={(e) => e.stopPropagation()} className="font-medium text-foreground no-underline hover:underline">
              {row.original.customerName}
            </Link>
            {row.original.customerStatus === "suspended" && <StatusBadge tone="warning" label="Suspended" />}
          </span>
        )
      },
      { id: "vehicle", header: "Vehicle", cell: ({ row }) => row.original.vehicleName ?? <span className="text-muted-foreground">Unassigned</span> },
      { id: "state", header: "Status", cell: ({ row }) => connectivity(row.original, now, onlineSeconds * 1000) },
      {
        id: "lastSeen",
        header: "Last seen",
        meta: { sortKey: "lastSeen", className: "whitespace-nowrap" } as ColumnMeta,
        cell: ({ row }) => (row.original.lastSeenAt ? <RelativeTime iso={row.original.lastSeenAt} /> : <span className="text-muted-foreground">Never</span>)
      }
    ],
    [now, onlineSeconds]
  );
  return (
    <>
      <PageHeader
        title="Trackers"
        description="Every tracker on the platform and the customer it belongs to. Search by name, model, customer or IMEI digits."
        breadcrumbs={[{ label: "Platform", href: "/admin" }, { label: "Trackers" }]}
      />
      <Card>
        <DataTable<PlatformTrackerRow>
          columns={columns}
          data={data.items}
          getRowId={(t) => t.id}
          total={data.total}
          page={data.page}
          pageSize={data.pageSize}
          sort={query.sort}
          direction={query.direction}
          onSort={(k, d) => set({ sort: k, direction: d })}
          onPage={(p) => set({ page: p })}
          onRowClick={(t) => router.push(`/admin/customers/${t.customerId}`)}
          rowLabel={(t) => `Open ${t.customerName}`}
          loading={pending}
          toolbar={
            <>
              <SearchInput value={query.search} onChange={(v) => set({ search: v })} placeholder="Name, customer or IMEI digits…" label="Search trackers" className="sm:w-72" />
              <SegmentedFilter
                label="Tracker status"
                value={query.state}
                onChange={(v) => set({ state: v === "all" ? null : v })}
                options={[
                  { value: "all", label: "All", count: data.counts.all },
                  { value: "online", label: "Online", count: data.counts.online },
                  { value: "silent", label: "Silent 24 h+", count: data.counts.silent },
                  { value: "never", label: "Never reported", count: data.counts.never },
                  { value: "deactivated", label: "Deactivated", count: data.counts.deactivated }
                ]}
              />
            </>
          }
          mobileRow={(t) => (
            <div className="flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{t.name ?? t.model ?? "Tracker"}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {t.customerName} · …{t.imeiLast4} · {t.lastSeenAt ? <RelativeTime iso={t.lastSeenAt} /> : "never"}
                </div>
              </div>
              {connectivity(t, now, onlineSeconds * 1000)}
            </div>
          )}
          empty={<EmptyState icon={Cpu} title={query.search || query.state !== "all" ? "No trackers match" : "No trackers registered yet"} description="Trackers are registered on a customer's page." />}
        />
      </Card>
    </>
  );
}
