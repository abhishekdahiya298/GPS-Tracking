"use client";
import { LocalDate } from "@/components/app/local-time";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, ArchiveRestore, Building2, Eye, MoreHorizontal, PauseCircle, PlayCircle, Plus, Settings2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { DataTable, type ColumnMeta } from "@/components/app/data-table";
import { PageHeader } from "@/components/app/page-header";
import { SearchInput } from "@/components/app/search-input";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { useListParams } from "@/components/app/use-list-params";
import { SegmentedFilter } from "@/components/app/filter-bar";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { CustomerListQuery, CustomerRow } from "@/lib/customers";
import dynamic from "next/dynamic";
import { viewAs } from "./_shared/view-as";
import { StatusDialog, type StatusAction } from "./_shared/status-dialog";
import { CUSTOMER_STATUS } from "./_shared/status-meta";

import type { PlanOption } from "./_shared/create-wizard";

const CreateCustomerWizard = dynamic(() => import("./_shared/create-wizard").then((m) => m.CreateCustomerWizard));

type Data = { items: CustomerRow[]; total: number; page: number; pageSize: number; counts: Record<CustomerListQuery["view"], number> };

export function CustomersView({ data, query, startCreating, plans }: { data: Data; query: CustomerListQuery; startCreating: boolean; plans: PlanOption[] }) {
  const router = useRouter();
  const { set, refresh, pending } = useListParams();
  const [creating, setCreating] = useState(startCreating);
  const [changing, setChanging] = useState<{ customer: CustomerRow; action: StatusAction } | null>(null);

  const columns = useMemo<ColumnDef<CustomerRow, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Customer",
        meta: { sortKey: "name" } as ColumnMeta,
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="font-medium">{row.original.name}</div>
            <div className="text-xs text-muted-foreground">{row.original.slug}</div>
          </div>
        )
      },
      { id: "members", header: "Users", meta: { sortKey: "members", className: "text-right tabular-nums" } as ColumnMeta, cell: ({ row }) => row.original.members },
      {
        id: "devices",
        header: "Trackers",
        meta: { sortKey: "devices", className: "text-right tabular-nums whitespace-nowrap" } as ColumnMeta,
        cell: ({ row }) => (
          <span>
            {row.original.devices}
            {row.original.devices > 0 && <span className="text-xs text-muted-foreground"> · {row.original.activeDevices} active</span>}
          </span>
        )
      },
      { id: "created", header: "Created", meta: { sortKey: "created", className: "whitespace-nowrap" } as ColumnMeta, cell: ({ row }) => <LocalDate iso={row.original.createdAt} /> },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => {
          const c = row.original;
          if (c.status !== "active") {
            const m = CUSTOMER_STATUS[c.status];
            return <StatusBadge tone={m.tone} label={m.label} />;
          }
          return c.devices === 0 ? <StatusBadge tone="warning" label="Setup: no trackers" /> : c.activeDevices > 0 ? <StatusBadge tone="success" label="Active" /> : <StatusBadge tone="neutral" label="No recent data" />;
        }
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        meta: { className: "w-0 text-right" } as ColumnMeta,
        cell: ({ row }) => (
          <div onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label={`Actions for ${row.original.name}`} size="icon-sm" variant="ghost">
                  <MoreHorizontal aria-hidden="true" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem asChild>
                  <Link href={`/admin/customers/${row.original.id}`}>
                    <Settings2 aria-hidden="true" /> Manage
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void viewAs(row.original.id)}>
                  <Eye aria-hidden="true" /> View as customer
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {row.original.status === "active" && (
                  <DropdownMenuItem onSelect={() => setChanging({ customer: row.original, action: "suspend" })}>
                    <PauseCircle aria-hidden="true" /> Suspend…
                  </DropdownMenuItem>
                )}
                {row.original.status === "suspended" && (
                  <DropdownMenuItem onSelect={() => setChanging({ customer: row.original, action: "reactivate" })}>
                    <PlayCircle aria-hidden="true" /> Reactivate…
                  </DropdownMenuItem>
                )}
                {row.original.status === "archived" ? (
                  <DropdownMenuItem onSelect={() => setChanging({ customer: row.original, action: "restore" })}>
                    <ArchiveRestore aria-hidden="true" /> Restore…
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem className="text-danger" onSelect={() => setChanging({ customer: row.original, action: "archive" })}>
                    <Archive aria-hidden="true" /> Archive…
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      }
    ],
    []
  );

  return (
    <>
      <PageHeader
        title="Customers"
        description="Every customer company on RIO GPS. Archived customers are kept and can be restored."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New customer
          </Button>
        }
      />
      <Card>
        <DataTable<CustomerRow>
          columns={columns}
          data={data.items}
          getRowId={(c) => c.id}
          total={data.total}
          page={data.page}
          pageSize={data.pageSize}
          sort={query.sort}
          direction={query.direction}
          onSort={(k, d) => set({ sort: k, direction: d })}
          onPage={(p) => set({ page: p })}
          onRowClick={(c) => router.push(`/admin/customers/${c.id}`)}
          rowLabel={(c) => `Manage ${c.name}`}
          loading={pending}
          toolbar={
            <>
              <SearchInput value={query.search} onChange={(v) => set({ search: v })} placeholder="Search customers…" label="Search customers" className="sm:w-72" />
              <SegmentedFilter
                label="Customer status"
                value={query.view}
                onChange={(v) => set({ view: v === "current" ? null : v })}
                options={[
                  { value: "current", label: "Current", count: data.counts.current },
                  { value: "suspended", label: "Suspended", count: data.counts.suspended },
                  { value: "archived", label: "Archived", count: data.counts.archived },
                  { value: "all", label: "All", count: data.counts.all }
                ]}
              />
            </>
          }
          mobileRow={(c) => (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 text-sm">
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-muted-foreground">
                  {c.members} users · {c.devices} trackers · <LocalDate iso={c.createdAt} />
                </div>
              </div>
              {c.status !== "active" && <StatusBadge tone={CUSTOMER_STATUS[c.status].tone} label={CUSTOMER_STATUS[c.status].label} />}
            </div>
          )}
          empty={
            query.search || query.view !== "current" ? (
              <EmptyState icon={Building2} title={query.view === "archived" && !query.search ? "No archived customers" : "No customers match"} />
            ) : (
              <EmptyState icon={Building2} title="No customers yet" action={<Button size="sm" onClick={() => setCreating(true)}><Plus /> New customer</Button>} />
            )
          }
        />
      </Card>
      {/* Mounted only when opened: a lazily loaded component rendered on the server makes Next emit a
          nonce-less <link rel=preload> that the strict CSP (correctly) blocks. */}
      {changing && (
        <StatusDialog
          customer={changing.customer}
          action={changing.action}
          onOpenChange={(o) => !o && setChanging(null)}
          onDone={() => {
            setChanging(null);
            refresh();
          }}
        />
      )}
      {creating && (
      <CreateCustomerWizard
        plans={plans}
        open={creating}
        onOpenChange={setCreating}
        onCreated={(id) => {
          refresh();
          router.push(`/admin/customers/${id}`);
        }}
      />
      )}
    </>
  );
}
