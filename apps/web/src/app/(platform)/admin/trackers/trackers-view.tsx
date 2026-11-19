"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, ArchiveRestore, ArrowRightLeft, Boxes, Building2, CardSim, CircleOff, Cpu, FlaskConical, ListPlus, MoreHorizontal, Pencil, Plus, Radio, Undo2, Warehouse, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { DataTable, type ColumnMeta } from "@/components/app/data-table";
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
import { cn } from "@/lib/cn";
import { deviceDisplayName, productName } from "@/lib/device-name";
import type { PlatformTrackerQuery, PlatformTrackerRow } from "@/lib/platform";
import { FormDialog } from "../_shared/form-dialog";
import { DemoTag, HideDemoToggle } from "../_shared/hide-demo-toggle";
import { PasteImportDialog } from "../_shared/paste-import";
import { SIM_STATUS } from "../_shared/sim-meta";
import { SimNumbers } from "../_shared/sim-numbers";
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

const label = (t: PlatformTrackerRow) => deviceDisplayName(t.name, t.model);

type State = PlatformTrackerQuery["state"];

/** One colour per tracker state, used by the filter tiles and the row icon. */
const STATES: { value: State; label: string; icon: LucideIcon; color: string }[] = [
  { value: "all", label: "All trackers", icon: Cpu, color: "#133a8f" },
  { value: "stock", label: "In stock", icon: Warehouse, color: "#0369a1" },
  { value: "deployed", label: "With customers", icon: Boxes, color: "#0f766e" },
  { value: "online", label: "Online", icon: Radio, color: "#15803d" },
  { value: "silent", label: "Silent 24 h+", icon: CircleOff, color: "#c2410c" },
  { value: "never", label: "Never reported", icon: CircleOff, color: "#b45309" },
  { value: "nosim", label: "No SIM", icon: CardSim, color: "#b91c1c" },
  { value: "demo", label: "Demo", icon: FlaskConical, color: "#5a1fc0" },
  { value: "retired", label: "Retired", icon: Archive, color: "#475569" }
];

/** The colour of a tracker's row icon: green online, amber silent, red never/no SIM, blue stock. */
function rowColor(t: PlatformTrackerRow, now: number, onlineMs: number) {
  if (t.status === "retired") return "#475569";
  if (!t.customer) return "#0369a1";
  if (t.status !== "active") return "#64748b";
  if (!t.lastSeenAt) return "#b45309";
  const age = now - new Date(t.lastSeenAt).getTime();
  if (age > DAY) return "#c2410c";
  if (age > onlineMs) return "#64748b";
  return "#15803d";
}

/** Coloured filter tiles: count, label and icon per state; the selected one is filled. */
function StateTiles({ value, counts, onChange }: { value: State; counts: Record<State, number>; onChange: (v: State) => void }) {
  return (
    <div role="radiogroup" aria-label="Tracker status" className="mb-4 grid grid-cols-[repeat(auto-fill,minmax(158px,1fr))] gap-2.5">
      {STATES.map((s) => {
        const on = value === s.value;
        const Icon = s.icon;
        return (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(s.value)}
            style={{
              borderColor: on ? s.color : `color-mix(in srgb, ${s.color} 30%, transparent)`,
              backgroundImage: on ? `linear-gradient(135deg, ${s.color}, color-mix(in srgb, ${s.color} 70%, #000))` : `linear-gradient(135deg, var(--color-background) 30%, color-mix(in srgb, ${s.color} 16%, var(--color-background)))`
            }}
            className={cn("flex cursor-pointer items-center gap-2.5 rounded-xl border p-3 text-left shadow-card transition-transform duration-150 hover:-translate-y-0.5", on ? "text-white" : "text-foreground")}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg" style={{ background: on ? "rgb(255 255 255 / 0.18)" : `color-mix(in srgb, ${s.color} 18%, transparent)`, color: on ? "#fff" : s.color }}>
              <Icon className="size-[18px]" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-xl font-semibold leading-6 tabular-nums">{counts[s.value] ?? 0}</span>
              <span className={cn("block truncate text-xs font-medium", on ? "text-white/85" : "text-muted-foreground")}>{s.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The tracker inventory: every unit RIO owns, in stock or with a customer, with its SIM.
 * Add units to stock as they arrive, assign them, move or take them back, retire faulty ones.
 */
export function TrackersView({ data, query, onlineSeconds, hideDemo }: { data: Data; query: PlatformTrackerQuery; onlineSeconds: number; hideDemo: boolean }) {
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
        cell: ({ row }) => {
          const t = row.original;
          const color = rowColor(t, now, onlineMs);
          return (
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}>
                <Cpu className="size-[18px]" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <div className="font-medium">{label(t)}</div>
                <div className="font-mono text-xs text-muted-foreground">{t.imei}</div>
                <div className="text-xs text-muted-foreground">
                  {[`${productName(t.model)}${t.model && productName(t.model) !== t.model ? ` (${t.model})` : ""}`, t.serialNumber ? `SN ${t.serialNumber}` : null].filter(Boolean).join(" · ")}
                </div>
              </div>
            </div>
          );
        }
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
              {c.isDemo && <DemoTag className="ml-1.5" />}
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
              <SimNumbers msisdn={s.msisdn} iccid={s.iccid} />
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
      <StateTiles value={query.state} counts={data.counts} onChange={(v) => set({ state: v === "all" ? null : v })} />
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
              <HideDemoToggle hidden={hideDemo} className="sm:ml-auto" />
            </>
          }
          mobileRow={(t) => (
            <div className="flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{label(t)}</div>
                <div className="truncate font-mono text-xs text-muted-foreground">{t.imei}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {t.customer?.isDemo ? "Demo · " : ""}{t.customer?.name ?? "RIO stock"} · {t.sim?.msisdn ?? (t.sim ? `SIM …${t.sim.iccid.slice(-4)}` : "no SIM")}
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
      description="Registers the IMEI on our GPS server now, so you can power it on and check it reports before it goes to a customer."
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
