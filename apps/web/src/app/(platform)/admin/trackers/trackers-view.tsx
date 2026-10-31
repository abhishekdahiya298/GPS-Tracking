"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, ArchiveRestore, ArrowRightLeft, Building2, Cpu, ListPlus, MoreHorizontal, Pencil, Plus, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { DataTable, type ColumnMeta } from "@/components/app/data-table";
import { SegmentedFilter } from "@/components/app/filter-bar";
import { RelativeTime } from "@/components/app/local-time";
import { PageHeader } from "@/components/app/page-header";
import { SearchInput } from "@/components/app/search-input";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { useListParams } from "@/components/app/use-list-params";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toaster";
import { api } from "@/lib/client/api";
import { isValidImei } from "@/lib/imei-list";
import type { PlatformTrackerQuery, PlatformTrackerRow } from "@/lib/platform";
import { FormDialog } from "../_shared/form-dialog";
import { PasteImportDialog } from "../_shared/paste-import";
import { SIM_STATUS } from "../_shared/sim-meta";
import { TrackerActionDialog, type TrackerAction } from "../_shared/tracker-actions";

type Data = { items: PlatformTrackerRow[]; total: number; page: number; pageSize: number; counts: Record<PlatformTrackerQuery["state"], number> };

const DAY = 86_400_000;

function connectivity(t: PlatformTrackerRow, now: number, onlineMs: number) {
  if (t.status === "retired") return <StatusBadge tone="neutral" label="Retired" />;
  if (!t.customer) return t.lastSeenAt && now - new Date(t.lastSeenAt).getTime() < onlineMs ? <StatusBadge tone="info" label="In stock · reporting" /> : <StatusBadge tone="info" label="In stock" />;
  if (t.status !== "active") return <StatusBadge tone="neutral" label="Deactivated by customer" />;
  if (!t.lastSeenAt) return <StatusBadge tone="warning" label="Never reported" />;
  const age = now - new Date(t.lastSeenAt).getTime();
  if (age > DAY) return <StatusBadge tone="warning" label="Silent 24 h+" />;
  if (age > onlineMs) return <StatusBadge tone="neutral" label="Offline" />;
  return <StatusBadge tone="success" label="Online" />;
}

const label = (t: PlatformTrackerRow) => t.name ?? t.model ?? "Tracker";

/**
 * The tracker inventory: every unit RIO owns, in stock or with a customer, with its SIM.
 * Add units to stock as they arrive, assign them, move or take them back, retire faulty ones.
 */
export function TrackersView({ data, query, onlineSeconds }: { data: Data; query: PlatformTrackerQuery; onlineSeconds: number }) {
  const router = useRouter();
  const { set, refresh, pending } = useListParams();
  const [adding, setAdding] = useState<"one" | "bulk" | null>(null);
  const [acting, setActing] = useState<{ t: PlatformTrackerRow; action: TrackerAction } | null>(null);
  const now = Date.now();
  const onlineMs = onlineSeconds * 1000;

  const columns = useMemo<ColumnDef<PlatformTrackerRow, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Tracker",
        meta: { sortKey: "name" } as ColumnMeta,
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="font-medium">{label(row.original)}</div>
            <div className="font-mono text-xs text-muted-foreground">{row.original.imei}</div>
            {(row.original.model && row.original.name) || row.original.serialNumber ? (
              <div className="text-xs text-muted-foreground">
                {[row.original.name ? row.original.model : null, row.original.serialNumber ? `SN ${row.original.serialNumber}` : null].filter(Boolean).join(" · ")}
              </div>
            ) : null}
          </div>
        )
      },
      {
        id: "customer",
        header: "Where",
        meta: { sortKey: "customer" } as ColumnMeta,
        cell: ({ row }) => {
          const c = row.original.customer;
          if (!c) return <span className="text-muted-foreground">{row.original.status === "retired" ? "Retired" : "RIO stock"}</span>;
          return (
            <div className="min-w-0">
              <Link href={`/admin/customers/${c.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-foreground no-underline hover:underline">
                {c.name}
              </Link>
              {c.status === "suspended" && <StatusBadge tone="warning" label="Suspended" className="ml-1.5" />}
              <div className="text-xs text-muted-foreground">{row.original.vehicleName ?? "Not on a vehicle"}</div>
            </div>
          );
        }
      },
      {
        id: "sim",
        header: "SIM",
        cell: ({ row }) => {
          const s = row.original.sim;
          if (!s) return row.original.status === "retired" ? <span className="text-muted-foreground">—</span> : <StatusBadge tone="warning" label="No SIM" />;
          const m = SIM_STATUS[s.status as keyof typeof SIM_STATUS];
          return (
            <div className="min-w-0 text-xs">
              <div className="font-medium text-foreground">{s.msisdn ?? `ICCID …${s.iccid.slice(-6)}`}</div>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                {s.carrier ?? "SIM"} {m && s.status !== "active" && <StatusBadge tone={m.tone} label={m.label} />}
              </div>
            </div>
          );
        }
      },
      { id: "state", header: "Status", cell: ({ row }) => connectivity(row.original, now, onlineMs) },
      {
        id: "lastSeen",
        header: "Last seen",
        meta: { sortKey: "lastSeen", className: "whitespace-nowrap" } as ColumnMeta,
        cell: ({ row }) => (row.original.lastSeenAt ? <RelativeTime iso={row.original.lastSeenAt} /> : <span className="text-muted-foreground">Never</span>)
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        meta: { className: "w-0 text-right" } as ColumnMeta,
        cell: ({ row }) => {
          const t = row.original;
          const act = (action: TrackerAction) => setActing({ t, action });
          return (
            <div onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton label={`Actions for ${label(t)}`} size="icon-sm" variant="ghost">
                    <MoreHorizontal aria-hidden="true" />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {!t.customer && t.status !== "retired" && (
                    <DropdownMenuItem onSelect={() => act("assign")}>
                      <Building2 aria-hidden="true" /> Assign to customer…
                    </DropdownMenuItem>
                  )}
                  {t.customer && (
                    <>
                      <DropdownMenuItem onSelect={() => act("move")}>
                        <ArrowRightLeft aria-hidden="true" /> Move to another customer…
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => act("return")}>
                        <Undo2 aria-hidden="true" /> Return to stock…
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuItem onSelect={() => act("edit")}>
                    <Pencil aria-hidden="true" /> Edit details…
                  </DropdownMenuItem>
                  {!t.customer && (
                    <>
                      <DropdownMenuSeparator />
                      {t.status === "retired" ? (
                        <DropdownMenuItem onSelect={() => act("unretire")}>
                          <ArchiveRestore aria-hidden="true" /> Put back in stock…
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem className="text-danger" onSelect={() => act("retire")}>
                          <Archive aria-hidden="true" /> Retire…
                        </DropdownMenuItem>
                      )}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        }
      }
    ],
    [now, onlineMs]
  );

  return (
    <>
      <PageHeader
        title="Trackers"
        description="Every tracker RIO owns: in stock, with a customer or retired, with its SIM. Search by IMEI, SIM number, phone, serial, model or customer."
        breadcrumbs={[{ label: "Platform", href: "/admin" }, { label: "Trackers" }]}
        actions={
          <>
            <Button variant="secondary" onClick={() => setAdding("bulk")}>
              <ListPlus /> Bulk add
            </Button>
            <Button onClick={() => setAdding("one")}>
              <Plus /> Add to stock
            </Button>
          </>
        }
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
          onRowClick={(t) => (t.customer ? router.push(`/admin/customers/${t.customer.id}`) : setActing({ t, action: t.status === "retired" ? "edit" : "assign" }))}
          rowLabel={(t) => (t.customer ? `Open ${t.customer.name}` : `Assign ${label(t)}`)}
          loading={pending}
          toolbar={
            <>
              <SearchInput value={query.search} onChange={(v) => set({ search: v })} placeholder="IMEI, SIM, phone, customer…" label="Search trackers" className="sm:w-64" />
              <SegmentedFilter
                label="Tracker status"
                value={query.state}
                onChange={(v) => set({ state: v === "all" ? null : v })}
                options={[
                  { value: "all", label: "All", count: data.counts.all },
                  { value: "stock", label: "In stock", count: data.counts.stock },
                  { value: "deployed", label: "With customers", count: data.counts.deployed },
                  { value: "silent", label: "Silent 24 h+", count: data.counts.silent },
                  { value: "never", label: "Never reported", count: data.counts.never },
                  { value: "nosim", label: "No SIM", count: data.counts.nosim },
                  { value: "retired", label: "Retired", count: data.counts.retired }
                ]}
              />
            </>
          }
          mobileRow={(t) => (
            <div className="flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{label(t)}</div>
                <div className="truncate font-mono text-xs text-muted-foreground">{t.imei}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {t.customer?.name ?? "RIO stock"} · {t.sim?.msisdn ?? (t.sim ? `SIM …${t.sim.iccid.slice(-4)}` : "no SIM")}
                </div>
              </div>
              {connectivity(t, now, onlineMs)}
            </div>
          )}
          empty={
            <EmptyState
              icon={Cpu}
              title={query.search || query.state !== "all" ? "No trackers match" : "No trackers yet"}
              description="Add trackers to stock as they arrive (Bulk add takes a pasted list with their SIMs), then assign them to customers."
              action={
                <Button size="sm" onClick={() => setAdding("bulk")}>
                  <ListPlus /> Bulk add
                </Button>
              }
            />
          }
        />
      </Card>

      {adding === "one" && <AddTrackerDialog onClose={() => setAdding(null)} onDone={refresh} />}
      {adding === "bulk" && (
        <PasteImportDialog
          title="Add trackers to stock"
          description="Paste the IMEIs from the box labels or the supplier's packing list. Add the SIM number (ICCID) and phone number on the same line to record which SIM is in each tracker."
          placeholder={"864361078566115, 8901260123456789012, +18055550101\n864361078566123, 8901260123456789020\n864361078566131"}
          needs="imei"
          extras={[{ name: "model", label: "Model (all lines)", kind: "text", defaultValue: "FTM880", required: true }]}
          okStatuses={["added"]}
          statusLabels={{ added: "Added", already_in_stock: "Already in stock", with_customer: "With a customer", invalid: "Invalid", failed: "Failed" }}
          submit={async (text, v) => {
            const out = await api<{ results: { line: number; imei: string | null; status: string; message?: string }[]; summary: Record<string, number> }>("/api/admin/trackers/bulk", { method: "POST", json: { model: v.model, text } });
            if (out.summary.added) toast.success(`${out.summary.added} tracker${out.summary.added === 1 ? "" : "s"} added to stock`);
            return {
              rows: out.results.map((r) => ({ line: r.line, key: r.imei, status: r.status, message: r.message })),
              done: [
                { label: "Added", value: out.summary.added ?? 0, good: true },
                { label: "Already in stock", value: out.summary.alreadyInStock ?? 0 },
                { label: "With a customer", value: out.summary.withCustomer ?? 0 },
                { label: "Problems", value: (out.summary.invalid ?? 0) + (out.summary.failed ?? 0) }
              ]
            };
          }}
          onOpenChange={(o) => !o && setAdding(null)}
          onDone={refresh}
        />
      )}
      {acting && (
        <TrackerActionDialog
          action={acting.action}
          tracker={{ id: acting.t.id, imei: acting.t.imei, label: label(acting.t), customerId: acting.t.customer?.id ?? null, customerName: acting.t.customer?.name ?? null, model: acting.t.model, serialNumber: acting.t.serialNumber, notes: acting.t.notes }}
          onOpenChange={(o) => !o && setActing(null)}
          onDone={() => {
            setActing(null);
            refresh();
          }}
        />
      )}
    </>
  );
}

function AddTrackerDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  return (
    <FormDialog
      title="Add a tracker to stock"
      description="Registers the IMEI in Traccar now, so you can power it on and check it reports before it goes to a customer."
      fields={[
        { name: "imei", label: "IMEI", kind: "text", required: true, numeric: true, maxLength: 20, description: "15 digits, on the device label.", half: true },
        { name: "model", label: "Model", kind: "text", required: true, defaultValue: "FTM880", maxLength: 60, half: true },
        { name: "iccid", label: "SIM number (ICCID)", kind: "text", numeric: true, maxLength: 30, description: "Optional: the SIM inside it (18-22 digits).", half: true },
        { name: "serialNumber", label: "Serial number", kind: "text", maxLength: 60, description: "Optional.", half: true },
        { name: "notes", label: "Notes", kind: "textarea", maxLength: 500 },
        { name: "allowUnchecked", label: "The IMEI fails the check digit, but I compared it with the label and it matches", kind: "checkbox" }
      ]}
      confirmLabel="Add to stock"
      onSubmit={async (v) => {
        const imei = String(v.imei).replace(/\D/g, "");
        if (imei.length === 15 && !isValidImei(imei) && !v.allowUnchecked) throw new Error("This IMEI fails the check digit, so a digit is probably mistyped. Compare it with the label, or tick the box below if it really matches.");
        await api("/api/admin/trackers", {
          method: "POST",
          json: {
            imei,
            model: String(v.model).trim(),
            ...(String(v.iccid).trim() ? { iccid: String(v.iccid).trim() } : {}),
            ...(String(v.serialNumber).trim() ? { serialNumber: String(v.serialNumber).trim() } : {}),
            ...(String(v.notes).trim() ? { notes: String(v.notes).trim() } : {}),
            allowUncheckedImei: Boolean(v.allowUnchecked)
          }
        });
        toast.success("Tracker added to stock");
        onClose();
        onDone();
      }}
      onOpenChange={(o) => !o && onClose()}
    />
  );
}
