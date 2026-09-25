"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { Building2, Eye, MoreHorizontal, Plus, Settings2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { DataTable, type ColumnMeta } from "@/components/app/data-table";
import { PageHeader } from "@/components/app/page-header";
import { SearchInput } from "@/components/app/search-input";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { useListParams } from "@/components/app/use-list-params";
import { Alert } from "@/components/ui/alert";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { CustomerListQuery, CustomerRow } from "@/lib/customers";
import dynamic from "next/dynamic";
import { viewAs } from "./_shared/view-as";

const CreateCustomerWizard = dynamic(() => import("./_shared/create-wizard").then((m) => m.CreateCustomerWizard));

export function CustomersView({ data, query, viewingAs }: { data: { items: CustomerRow[]; total: number; page: number; pageSize: number }; query: CustomerListQuery; viewingAs: string | null }) {
  const router = useRouter();
  const { set, refresh, pending } = useListParams();
  const [creating, setCreating] = useState(false);

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
        header: "Devices",
        meta: { sortKey: "devices", className: "text-right tabular-nums whitespace-nowrap" } as ColumnMeta,
        cell: ({ row }) => (
          <span>
            {row.original.devices}
            {row.original.devices > 0 && <span className="text-xs text-muted-foreground"> · {row.original.activeDevices} active</span>}
          </span>
        )
      },
      { id: "created", header: "Created", meta: { sortKey: "created", className: "whitespace-nowrap" } as ColumnMeta, cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString() },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) =>
          row.original.devices === 0 ? <StatusBadge tone="warning" label="Setup: no devices" /> : row.original.activeDevices > 0 ? <StatusBadge tone="success" label="Active" /> : <StatusBadge tone="neutral" label="No recent data" />
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
        description="Every customer organization on the platform. Platform admins only."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New customer
          </Button>
        }
      />
      {viewingAs && (
        <div className="mb-4">
          <Alert tone="info" title="You are viewing the app as a customer" action={<Button size="sm" variant="secondary" onClick={() => viewAs(null)}>Exit view-as</Button>}>
            Pages outside Customers show that customer&apos;s data.
          </Alert>
        </div>
      )}
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
          toolbar={<SearchInput value={query.search} onChange={(v) => set({ search: v })} placeholder="Search customers…" label="Search customers" className="sm:w-72" />}
          mobileRow={(c) => (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 text-sm">
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-muted-foreground">
                  {c.members} users · {c.devices} devices · {new Date(c.createdAt).toLocaleDateString()}
                </div>
              </div>
            </div>
          )}
          empty={
            query.search ? (
              <EmptyState icon={Building2} title="No customers match" />
            ) : (
              <EmptyState icon={Building2} title="No customers yet" action={<Button size="sm" onClick={() => setCreating(true)}><Plus /> New customer</Button>} />
            )
          }
        />
      </Card>
      {/* Mounted only when opened: a lazily loaded component rendered on the server makes Next emit a
          nonce-less <link rel=preload> that the strict CSP (correctly) blocks. */}
      {creating && (
      <CreateCustomerWizard
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
