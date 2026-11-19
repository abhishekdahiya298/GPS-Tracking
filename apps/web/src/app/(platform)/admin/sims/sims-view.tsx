"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Ban, CardSim, CircleDollarSign, CirclePause, Layers, Link2, Link2Off, ListPlus, Pencil, Plus, RefreshCw, Warehouse } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { DataTable, type ColumnMeta } from "@/components/app/data-table";
import { FilterTiles, IconCell, RowActions } from "@/components/app/list-kit";
import { PageHeader } from "@/components/app/page-header";
import { RelativeTime } from "@/components/app/local-time";
import { SearchInput } from "@/components/app/search-input";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { useListParams } from "@/components/app/use-list-params";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";
import { api } from "@/lib/client/api";
import type { SimListQuery, SimRow } from "@/lib/sims";
import { FormDialog, type FieldSpec, type FormValues } from "../_shared/form-dialog";
import { PasteImportDialog } from "../_shared/paste-import";
import { SimNumbers } from "../_shared/sim-numbers";
import { SIM_STATUS } from "../_shared/sim-meta";

type Counts = Record<SimListQuery["view"], number> & { monthly: number; wasted: number };
type Data = { items: SimRow[]; total: number; page: number; pageSize: number; counts: Counts };

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const STATUS_OPTIONS = (Object.keys(SIM_STATUS) as (keyof typeof SIM_STATUS)[]).map((k) => ({ value: k, label: SIM_STATUS[k].label }));
const ATTENTION: Record<NonNullable<SimRow["attention"]>, string> = {
  active_unused: "Billed but not in use: suspend or cancel it, or put it in a tracker",
  deployed_not_active: "In a customer's tracker but not active: the tracker can't report"
};

/** Status colours, the same family as the tracker list. */
const SIM_COLOR: Record<string, string> = { active: "#15803d", inventory: "#0369a1", suspended: "#c2410c", cancelled: "#475569" };

function simFields(s?: SimRow): FieldSpec[] {
  return [
    ...(s ? [] : [{ name: "iccid", label: "SIM number (ICCID)", kind: "text" as const, required: true, numeric: true, maxLength: 30, description: "18-22 digits, printed on the card." }]),
    { name: "msisdn", label: "Phone number", kind: "tel", maxLength: 30, defaultValue: s?.msisdn ?? "", placeholder: "+1 805 555 0100", half: true },
    { name: "status", label: "Status", kind: "select", options: STATUS_OPTIONS, defaultValue: s?.status ?? "inventory", half: true },
    { name: "carrier", label: "Carrier", kind: "text", maxLength: 60, defaultValue: s?.carrier ?? "", placeholder: "e.g. AT&T, Hologram, 1NCE", half: true },
    { name: "plan", label: "Plan", kind: "text", maxLength: 80, defaultValue: s?.plan ?? "", placeholder: "e.g. 10 MB pooled", half: true },
    { name: "apn", label: "APN", kind: "text", maxLength: 80, defaultValue: s?.apn ?? "", description: "Set in the tracker's configuration.", half: true },
    { name: "monthlyCost", label: "Monthly cost (USD)", kind: "money", maxLength: 12, defaultValue: s?.monthlyCostCents != null ? (s.monthlyCostCents / 100).toFixed(2) : "", half: true },
    { name: "notes", label: "Notes", kind: "textarea", maxLength: 500, defaultValue: s?.notes ?? "" }
  ];
}
const simBody = (v: FormValues) => ({
  msisdn: String(v.msisdn ?? ""),
  status: v.status,
  carrier: String(v.carrier ?? ""),
  plan: String(v.plan ?? ""),
  apn: String(v.apn ?? ""),
  monthlyCost: String(v.monthlyCost ?? "").trim() === "" ? null : String(v.monthlyCost),
  notes: String(v.notes ?? "")
});

/** Every data SIM RIO pays for: which tracker and customer it serves, and which ones waste money. */
export function SimsView({ data, query, hologram }: { data: Data; query: SimListQuery; hologram: { configured: boolean; lastSync: string | null } }) {
  const { set, refresh, pending } = useListParams();
  const [dialog, setDialog] = useState<{ kind: "add" | "bulk" | "cost" } | { kind: "edit" | "link"; sim: SimRow } | null>(null);
  const [syncing, setSyncing] = useState(false);
  async function syncNow() {
    setSyncing(true);
    try {
      const r = await api<{ seen: number; added: number; updated: number; linked: number; unmatched: string[] }>("/api/admin/sims/sync", { method: "POST" });
      toast.success(`Hologram: ${r.seen} SIMs checked, ${r.added} new, ${r.linked} matched to trackers${r.unmatched.length ? `, ${r.unmatched.length} not matched` : ""}`);
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSyncing(false);
    }
  }
  const close = () => setDialog(null);
  const done = () => {
    setDialog(null);
    refresh();
  };

  const columns = useMemo<ColumnDef<SimRow, unknown>[]>(
    () => [
      {
        id: "iccid",
        header: "SIM",
        meta: { sortKey: "iccid" } as ColumnMeta,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <IconCell
              icon={CardSim}
              color={r.attention ? "#b91c1c" : (SIM_COLOR[r.status] ?? "#475569")}
              title={<span className="font-mono">{r.msisdn ?? "No phone number"}</span>}
              lines={[<span key="i" className="font-mono" title="ICCID: printed on the SIM card">ICCID {r.iccid}</span>]}
            />
          );
        }
      },
      {
        id: "carrier",
        header: "Carrier",
        cell: ({ row }) => (
          <div className="min-w-0 text-sm">
            <div className="font-medium">{row.original.carrier ?? <span className="text-muted-foreground">—</span>}</div>
            <div className="max-w-56 truncate text-xs text-muted-foreground" title={row.original.plan ?? undefined}>
              {[row.original.plan, row.original.monthlyCostCents != null ? `${money(row.original.monthlyCostCents)}/mo` : null].filter(Boolean).join(" · ")}
            </div>
          </div>
        )
      },
      {
        id: "status",
        header: "Status",
        meta: { sortKey: "status" } as ColumnMeta,
        cell: ({ row }) => {
          const m = SIM_STATUS[row.original.status];
          return (
            <div className="flex items-center gap-1.5">
              <StatusBadge tone={m.tone} label={m.label} />
              {row.original.attention && (
                <span title={ATTENTION[row.original.attention]} className="inline-flex items-center gap-1 rounded-md bg-danger/10 px-1.5 py-0.5 text-[11px] font-semibold text-danger">
                  <AlertTriangle className="size-3" aria-hidden="true" /> Check
                </span>
              )}
            </div>
          );
        }
      },
      {
        id: "customer",
        header: "Customer / tracker",
        meta: { sortKey: "customer" } as ColumnMeta,
        cell: ({ row }) => {
          const d = row.original.device;
          if (!d) return <span className="text-sm text-muted-foreground">Not in a tracker</span>;
          return (
            <div className="min-w-0 text-sm">
              {row.original.customer ? (
                <Link href={`/admin/customers/${row.original.customer.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-foreground no-underline hover:underline">
                  {row.original.customer.name}
                </Link>
              ) : (
                <span className="text-muted-foreground">{d.status === "retired" ? "Retired tracker" : "RIO stock"}</span>
              )}
              <div className="font-mono text-xs text-muted-foreground">IMEI {d.imei}</div>
            </div>
          );
        }
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        meta: { className: "w-0 whitespace-nowrap text-right" } as ColumnMeta,
        cell: ({ row }) => (
          <RowActions
            actions={[
              { icon: Pencil, label: "Edit SIM", onClick: () => setDialog({ kind: "edit", sim: row.original }) },
              { icon: Link2, label: row.original.device ? "Move to another tracker" : "Put in a tracker", onClick: () => setDialog({ kind: "link", sim: row.original }) },
              {
                icon: Link2Off,
                label: "Take out of tracker",
                tone: "danger",
                hidden: !row.original.device,
                onClick: async () => {
                  try {
                    await api(`/api/admin/sims/${row.original.id}/link`, { method: "POST", json: { imei: null } });
                    toast.success("SIM taken out of the tracker");
                    refresh();
                  } catch (err) {
                    toast.error((err as Error).message);
                  }
                }
              }
            ]}
          />
        )
      }
    ],
    [refresh]
  );

  return (
    <>
      <PageHeader
        title="SIM cards"
        description={`${data.counts.active} active SIM${data.counts.active === 1 ? "" : "s"}${data.counts.monthly ? ` · ${money(data.counts.monthly)} a month` : ""}${data.counts.wasted ? ` · ${money(data.counts.wasted)} a month on SIMs not in use` : ""}`}
        breadcrumbs={[{ label: "Platform", href: "/admin" }, { label: "SIM cards" }]}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDialog({ kind: "cost" })}>
              <CircleDollarSign /> Monthly cost
            </Button>
            <Button variant="secondary" onClick={() => setDialog({ kind: "bulk" })}>
              <ListPlus /> Import list
            </Button>
            <Button onClick={() => setDialog({ kind: "add" })}>
              <Plus /> Add SIM
            </Button>
          </>
        }
      />
      <FilterTiles
        label="SIM status"
        value={query.view}
        onChange={(v) => set({ view: v === "all" ? null : v })}
        options={[
          { value: "all", label: "All SIMs", count: data.counts.all, icon: Layers, color: "#133a8f" },
          { value: "attention", label: "Needs attention", count: data.counts.attention, icon: AlertTriangle, color: "#b91c1c" },
          { value: "active", label: "Active", count: data.counts.active, icon: CardSim, color: "#15803d" },
          { value: "inventory", label: "Not activated", count: data.counts.inventory, icon: Warehouse, color: "#0369a1" },
          { value: "suspended", label: "Suspended", count: data.counts.suspended, icon: CirclePause, color: "#c2410c" },
          { value: "cancelled", label: "Cancelled", count: data.counts.cancelled, icon: Ban, color: "#475569" }
        ]}
      />
      <Card>
        <DataTable<SimRow>
          columns={columns}
          data={data.items}
          getRowId={(s) => s.id}
          total={data.total}
          page={data.page}
          pageSize={data.pageSize}
          sort={query.sort}
          direction={query.direction}
          onSort={(k, d) => set({ sort: k, direction: d })}
          onPage={(p) => set({ page: p })}
          onPageSize={(n) => set({ pageSize: n })}
          onRowClick={(s) => setDialog({ kind: "edit", sim: s })}
          rowLabel={(s) => `Edit SIM ${s.iccid}`}
          loading={pending}
          toolbar={
            <>
              <SearchInput value={query.search} onChange={(v) => set({ search: v })} placeholder="ICCID, phone, carrier, IMEI, customer…" label="Search SIMs" className="sm:w-64" />
              <div className="flex items-center gap-2 text-[13px] text-muted-foreground sm:ml-auto">
                <span
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-3"
                  title={hologram.configured ? "Status, plan and tracker come from Hologram; manage SIMs there. Put the tracker's IMEI in the SIM's name in Hologram and it links on its own." : "Add a Hologram API key to the server settings and this list fills itself in."}
                >
                  <span className={hologram.configured ? "size-2 rounded-full bg-[#15803d]" : "size-2 rounded-full bg-[#c2410c]"} aria-hidden="true" />
                  {hologram.configured ? <>Hologram · synced {hologram.lastSync ? <RelativeTime iso={hologram.lastSync} /> : "not yet"}</> : "Hologram not connected"}
                </span>
                {hologram.configured && (
                  <Button size="sm" variant="secondary" loading={syncing} onClick={() => void syncNow()}>
                    <RefreshCw /> Sync
                  </Button>
                )}
              </div>
            </>
          }
          mobileRow={(s) => (
            <div className="flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{s.providerName ?? s.msisdn ?? `…${s.iccid.slice(-6)}`}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {s.customer?.name ?? (s.device ? "RIO stock" : "Not in a tracker")} · {s.carrier ?? "—"}
                </div>
                {s.attention && <div className="text-xs text-danger">{ATTENTION[s.attention]}</div>}
              </div>
              <StatusBadge tone={SIM_STATUS[s.status].tone} label={SIM_STATUS[s.status].label} />
            </div>
          )}
          empty={
            <EmptyState
              icon={CardSim}
              title={query.search || query.view !== "all" ? "No SIMs match" : "No SIMs yet"}
              description="Import the carrier's list (ICCID and phone number per line), or add SIMs with their trackers on the Trackers page."
            />
          }
        />
      </Card>

      {dialog?.kind === "add" && (
        <FormDialog
          title="Add a SIM"
          fields={simFields()}
          confirmLabel="Add SIM"
          onSubmit={async (v) => {
            await api("/api/admin/sims", { method: "POST", json: { iccid: String(v.iccid), ...simBody(v) } });
            toast.success("SIM added");
            done();
          }}
          onOpenChange={(o) => !o && close()}
        />
      )}
      {dialog?.kind === "cost" && (
        <FormDialog
          title="Monthly cost per SIM"
          intro={<p className="m-0 text-sm text-muted-foreground">Used to show what SIMs cost each month and how much goes on SIMs that aren&apos;t in use. Check the price on your Hologram invoice or plan page.</p>}
          fields={[
            { name: "monthlyCost", label: "Monthly cost per SIM (USD)", kind: "money", required: true, maxLength: 12, half: true },
            { name: "scope", label: "Apply to", kind: "select", defaultValue: "hologram", options: [{ value: "hologram", label: "All Hologram SIMs" }, { value: "all", label: "All SIMs" }], half: true }
          ]}
          confirmLabel="Apply"
          onSubmit={async (v) => {
            const out = await api<{ updated: number }>("/api/admin/sims/cost", { method: "POST", json: { monthlyCost: String(v.monthlyCost), scope: v.scope } });
            toast.success(`Monthly cost set on ${out.updated} SIM${out.updated === 1 ? "" : "s"}`);
            done();
          }}
          onOpenChange={(o) => !o && close()}
        />
      )}
      {dialog?.kind === "edit" && dialog.sim.provider === "hologram" && (
        <FormDialog
          title="Edit SIM"
          description={`ICCID ${dialog.sim.iccid} · ${dialog.sim.providerName ? `“${dialog.sim.providerName}” · ` : ""}${dialog.sim.plan ?? "Hologram"}`}
          intro={<p className="m-0 text-sm text-muted-foreground">Status, plan, phone number and tracker come from Hologram (activate, pause or cancel the SIM there). Here you keep the cost and your notes.</p>}
          fields={simFields(dialog.sim).filter((f) => f.name === "monthlyCost" || f.name === "notes")}
          confirmLabel="Save"
          onSubmit={async (v) => {
            await api(`/api/admin/sims/${dialog.sim.id}`, { method: "PATCH", json: { monthlyCost: String(v.monthlyCost ?? "").trim() === "" ? null : String(v.monthlyCost), notes: String(v.notes ?? "") } });
            toast.success("SIM updated");
            done();
          }}
          onOpenChange={(o) => !o && close()}
        />
      )}
      {dialog?.kind === "edit" && dialog.sim.provider !== "hologram" && (
        <FormDialog
          title="Edit SIM"
          description={`ICCID ${dialog.sim.iccid}`}
          intro={<p className="m-0 text-sm text-muted-foreground">Change the status here after you activate, suspend or cancel the SIM with the carrier, so this list matches your bill.</p>}
          fields={simFields(dialog.sim)}
          confirmLabel="Save"
          onSubmit={async (v) => {
            await api(`/api/admin/sims/${dialog.sim.id}`, { method: "PATCH", json: simBody(v) });
            toast.success("SIM updated");
            done();
          }}
          onOpenChange={(o) => !o && close()}
        />
      )}
      {dialog?.kind === "link" && (
        <FormDialog
          title={dialog.sim.device ? "Move SIM to another tracker" : "Put SIM in a tracker"}
          description={`ICCID ${dialog.sim.iccid}`}
          intro={<p className="m-0 text-sm text-muted-foreground">If that tracker already has a SIM, it is taken out of the tracker (it stays in this list).</p>}
          fields={[{ name: "imei", label: "Tracker IMEI", kind: "text", required: true, numeric: true, maxLength: 20 }]}
          confirmLabel="Save"
          onSubmit={async (v) => {
            const out = await api<{ replacedIccidLast4: string | null }>(`/api/admin/sims/${dialog.sim.id}/link`, { method: "POST", json: { imei: String(v.imei).replace(/\D/g, "") } });
            toast.success(out.replacedIccidLast4 ? `SIM linked; SIM …${out.replacedIccidLast4} was taken out` : "SIM linked");
            done();
          }}
          onOpenChange={(o) => !o && close()}
        />
      )}
      {dialog?.kind === "bulk" && (
        <PasteImportDialog
          title="Import SIMs"
          description="Paste the carrier's list: the SIM number (ICCID) on each line, and optionally its phone number and the IMEI of the tracker it goes in."
          placeholder={"8901260123456789012, +18055550101\n8901260123456789020, +18055550102, 864361078566115"}
          needs="iccid"
          extras={[
            { name: "carrier", label: "Carrier", kind: "text", defaultValue: "", placeholder: "e.g. AT&T" },
            { name: "plan", label: "Plan", kind: "text", defaultValue: "" },
            { name: "status", label: "Status", kind: "select", defaultValue: "inventory", options: STATUS_OPTIONS },
            { name: "monthlyCost", label: "Monthly cost each (USD)", kind: "money", defaultValue: "" }
          ]}
          okStatuses={["added", "linked"]}
          statusLabels={{ added: "Added", linked: "Added and put in tracker", already_listed: "Already in the list", invalid: "Invalid", failed: "Failed" }}
          submit={async (text, v) => {
            const out = await api<{ results: { line: number; iccid: string | null; status: string; message?: string }[]; summary: Record<string, number> }>("/api/admin/sims/bulk", {
              method: "POST",
              json: { text, carrier: v.carrier, plan: v.plan, status: v.status, monthlyCost: (v.monthlyCost ?? "").trim() === "" ? null : v.monthlyCost }
            });
            if (out.summary.added) toast.success(`${out.summary.added} SIM${out.summary.added === 1 ? "" : "s"} added`);
            return {
              rows: out.results.map((r) => ({ line: r.line, key: r.iccid, status: r.status, message: r.message })),
              done: [
                { label: "Added", value: out.summary.added ?? 0, good: true },
                { label: "Put in trackers", value: out.summary.linked ?? 0 },
                { label: "Already listed", value: out.summary.alreadyListed ?? 0 },
                { label: "Problems", value: (out.summary.invalid ?? 0) + (out.summary.failed ?? 0) }
              ]
            };
          }}
          onOpenChange={(o) => !o && close()}
          onDone={refresh}
        />
      )}
    </>
  );
}
