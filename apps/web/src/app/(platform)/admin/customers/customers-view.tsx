"use client";
import { LocalDate } from "@/components/app/local-time";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, ArchiveRestore, Building2, Eye, Layers, MoreHorizontal, PauseCircle, Pencil, PlayCircle, Plus, Power, Settings2, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { DataTable, type ColumnMeta } from "@/components/app/data-table";
import { PageHeader } from "@/components/app/page-header";
import { SearchInput } from "@/components/app/search-input";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { useListParams } from "@/components/app/use-list-params";
import { ACTION_COLOR, FilterTiles, RowActions } from "@/components/app/list-kit";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { CustomerListQuery, CustomerRow } from "@/lib/customers";
import dynamic from "next/dynamic";
import { viewAs } from "./_shared/view-as";
import { StatusDialog, type StatusAction } from "./_shared/status-dialog";
import { CUSTOMER_STATUS } from "./_shared/status-meta";

import type { PlanOption } from "./_shared/create-wizard";

import { DemoTag, HideDemoToggle } from "../_shared/hide-demo-toggle";
const CreateCustomerWizard = dynamic(() => import("./_shared/create-wizard").then((m) => m.CreateCustomerWizard));

type Data = { items: CustomerRow[]; total: number; page: number; pageSize: number; counts: Record<CustomerListQuery["view"], number> };

export function CustomersView({ data, query, startCreating, plans, hideDemo }: { data: Data; query: CustomerListQuery; startCreating: boolean; plans: PlanOption[]; hideDemo: boolean }) {
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
        cell: ({ row }) => {
          const c = row.original;
          return (
            <div className="flex min-w-0 items-center gap-3">
              <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold text-white" style={{ background: avatarColor(c.name) }}>
                {initials(c.name)}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 truncate font-semibold">
                  {c.name}
                  {c.isDemo && <DemoTag />}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {c.slug} · {c.members} user{c.members === 1 ? "" : "s"}
                </div>
              </div>
            </div>
          );
        }
      },
      {
        id: "plan",
        header: "Plan",
        cell: ({ row }) =>
          row.original.planName ? (
            <span className="inline-flex flex-wrap items-center gap-1">
              <span className="inline-flex h-6 items-center rounded-full bg-primary-soft px-2.5 text-xs font-semibold text-primary">{row.original.planName}</span>
              {row.original.trialEndsAt && <span className="text-[11px] font-semibold text-warning">Trial</span>}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">No plan</span>
          )
      },
      {
        id: "devices",
        header: "Trackers",
        meta: { sortKey: "devices", className: "whitespace-nowrap" } as ColumnMeta,
        cell: ({ row }) => {
          const c = row.original;
          const pct = c.devices ? Math.round((c.activeDevices / c.devices) * 100) : 0;
          return (
            <span className="flex items-center gap-2">
              <b className="w-5 tabular-nums">{c.devices}</b>
              <span aria-hidden="true" className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
              </span>
              <span className="text-xs text-muted-foreground">{c.activeDevices} online</span>
            </span>
          );
        }
      },
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
      { id: "created", header: "Since", meta: { sortKey: "created", className: "whitespace-nowrap" } as ColumnMeta, cell: ({ row }) => <LocalDate iso={row.original.createdAt} /> },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        meta: { className: "w-0 text-right" } as ColumnMeta,
        cell: ({ row }) => {
          const c = row.original;
          return (
            <RowActions
              actions={[
                { icon: Eye, label: "View as customer", color: ACTION_COLOR.map, onClick: () => void viewAs(c.id) },
                { icon: Pencil, label: "Manage", color: ACTION_COLOR.edit, href: `/admin/customers/${c.id}` }
              ]}
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton label={`More for ${c.name}`} size="icon-sm" variant="ghost">
                    <MoreHorizontal aria-hidden="true" />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem asChild>
                    <Link href={`/admin/customers/${c.id}`}>
                      <Settings2 aria-hidden="true" /> Manage
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {c.status === "active" && (
                    <DropdownMenuItem onSelect={() => setChanging({ customer: c, action: "suspend" })}>
                      <PauseCircle aria-hidden="true" /> Suspend…
                    </DropdownMenuItem>
                  )}
                  {c.status === "suspended" && (
                    <DropdownMenuItem onSelect={() => setChanging({ customer: c, action: "reactivate" })}>
                      <PlayCircle aria-hidden="true" /> Reactivate…
                    </DropdownMenuItem>
                  )}
                  {c.status === "archived" ? (
                    <DropdownMenuItem onSelect={() => setChanging({ customer: c, action: "restore" })}>
                      <ArchiveRestore aria-hidden="true" /> Restore…
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem className="text-danger" onSelect={() => setChanging({ customer: c, action: "archive" })}>
                      <Archive aria-hidden="true" /> Archive…
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </RowActions>
          );
        }
      }
    ],
    []
  );

  return (
    <>
      <PageHeader
        title="Customers"
        description={`${data.counts.current} customer compan${data.counts.current === 1 ? "y" : "ies"}. Archived customers are kept and can be restored.`}
        actions={
          <>
            <HideDemoToggle hidden={hideDemo} onDark />
            <Button variant="secondary" onClick={() => setCreating(true)}>
              <Plus /> New customer
            </Button>
          </>
        }
      />
      <FilterTiles
        label="Customer status"
        value={query.view}
        onChange={(v) => set({ view: v === "current" ? null : v })}
        options={[
          { value: "current", label: "Current", count: data.counts.current, icon: Building2, color: "#0a2463" },
          { value: "suspended", label: "Suspended", count: data.counts.suspended, icon: Power, color: "#b91c1c" },
          { value: "archived", label: "Archived", count: data.counts.archived, icon: Layers, color: "#526079" },
          { value: "all", label: "All", count: data.counts.all, icon: Users, color: "#6d28d9" }
        ]}
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
            </>
          }
          mobileRow={(c) => (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 text-sm">
                <div className="flex items-center gap-1.5 font-medium">
                  {c.name}
                  {c.isDemo && <DemoTag />}
                </div>
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

const AVATAR = ["#1d4ed8", "#0f766e", "#6d28d9", "#9a3412", "#be185d", "#0369a1", "#15803d", "#4338ca"];
function avatarColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `linear-gradient(150deg, ${AVATAR[h % AVATAR.length]}, #0a2463)`;
}
function initials(name: string): string {
  const w = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] ?? "") + (w[1]?.[0] ?? w[0]?.[1] ?? "")).toUpperCase();
}
