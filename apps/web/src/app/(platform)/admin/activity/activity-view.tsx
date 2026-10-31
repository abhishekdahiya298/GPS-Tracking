"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { History } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { DataTable, type ColumnMeta } from "@/components/app/data-table";
import { SegmentedFilter } from "@/components/app/filter-bar";
import { LocalTime } from "@/components/app/local-time";
import { PageHeader } from "@/components/app/page-header";
import { SearchInput } from "@/components/app/search-input";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { useListParams } from "@/components/app/use-list-params";
import { Card } from "@/components/ui/card";
import type { ActivityQuery, ActivityRow } from "@/lib/platform";
import { actionLabel } from "@/lib/platform-labels";

type Data = { items: ActivityRow[]; total: number; page: number; pageSize: number };

/** Short, readable summary of the audit metadata (never secrets: see auditLogs). */
function details(r: ActivityRow): string {
  const m = r.metadata ?? {};
  const parts: string[] = [];
  if (typeof m.reason === "string") parts.push(`Reason: ${m.reason}`);
  if (typeof m.role === "string") parts.push(String(m.role).replace(/_/g, " ").toLowerCase());
  if (typeof m.model === "string") parts.push(m.model);
  if (typeof m.imeiLast4 === "string") parts.push(`IMEI …${m.imeiLast4}`);
  if (typeof m.registered === "number") parts.push(`${m.registered} registered`);
  if (typeof m.slug === "string") parts.push(m.slug);
  return parts.join(" · ");
}

/** The audit trail across every customer, newest first. Defaults to what platform admins did. */
export function ActivityView({ data, query }: { data: Data; query: ActivityQuery }) {
  const { set, pending } = useListParams();
  const columns = useMemo<ColumnDef<ActivityRow, unknown>[]>(
    () => [
      { id: "at", header: "When", meta: { className: "whitespace-nowrap" } as ColumnMeta, cell: ({ row }) => <LocalTime iso={row.original.at} /> },
      {
        id: "action",
        header: "What",
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="font-medium">{actionLabel(row.original.action)}</div>
            {details(row.original) && <div className="max-w-md truncate text-xs text-muted-foreground">{details(row.original)}</div>}
          </div>
        )
      },
      {
        id: "customer",
        header: "Customer",
        cell: ({ row }) =>
          row.original.customerId ? (
            <Link href={`/admin/customers/${row.original.customerId}`} className="text-foreground no-underline hover:underline">
              {row.original.customerName}
            </Link>
          ) : (
            <span className="text-muted-foreground">Platform</span>
          )
      },
      {
        id: "who",
        header: "Who",
        cell: ({ row }) => (
          <span className="flex flex-wrap items-center gap-1.5">
            {row.original.actorName ?? <span className="text-muted-foreground">System</span>}
            {row.original.actorIsPlatform && <StatusBadge tone="primary" label="Platform" />}
          </span>
        )
      },
      { id: "ip", header: "IP address", meta: { className: "whitespace-nowrap text-xs text-muted-foreground", hideable: true } as ColumnMeta, cell: ({ row }) => row.original.ipAddress ?? "—" }
    ],
    []
  );
  return (
    <>
      <PageHeader
        title="Activity log"
        description="Who did what, across every customer. Kept permanently; entries can't be edited or removed."
        breadcrumbs={[{ label: "Platform", href: "/admin" }, { label: "Activity log" }]}
      />
      <Card>
        <DataTable<ActivityRow>
          columns={columns}
          data={data.items}
          getRowId={(r) => r.id}
          total={data.total}
          page={data.page}
          pageSize={data.pageSize}
          sort="at"
          direction="desc"
          onSort={() => undefined}
          onPage={(p) => set({ page: p })}
          loading={pending}
          toolbar={
            <>
              <SearchInput value={query.search} onChange={(v) => set({ search: v })} placeholder="Customer, email or action…" label="Search activity" className="sm:w-64" />
              <SegmentedFilter
                label="Kind of activity"
                value={query.kind}
                onChange={(v) => set({ kind: v === "all" ? null : v })}
                options={[
                  { value: "all", label: "All" },
                  { value: "customers", label: "Customers" },
                  { value: "trackers", label: "Trackers" },
                  { value: "people", label: "Users" },
                  { value: "access", label: "Access" }
                ]}
              />
              <SegmentedFilter
                label="Done by"
                value={query.who}
                onChange={(v) => set({ who: v === "platform" ? null : v })}
                options={[
                  { value: "platform", label: "Platform admins" },
                  { value: "everyone", label: "Everyone" }
                ]}
              />
            </>
          }
          mobileRow={(r) => (
            <div className="text-sm">
              <div className="font-medium">{actionLabel(r.action)}</div>
              <div className="text-xs text-muted-foreground">
                {r.customerName ?? "Platform"} · {r.actorName ?? "System"} · <LocalTime iso={r.at} />
              </div>
            </div>
          )}
          empty={<EmptyState icon={History} title="No activity matches" />}
        />
      </Card>
    </>
  );
}
