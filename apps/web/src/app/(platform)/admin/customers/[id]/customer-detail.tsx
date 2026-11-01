"use client";
import { Archive, ArchiveRestore, ArrowRightLeft, Cpu, Eye, KeyRound, ListPlus, MoreHorizontal, PauseCircle, Pencil, PlayCircle, Plus, ShieldOff, Undo2, UserCog, UserMinus, UserPlus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { Alert } from "@/components/ui/alert";
import { Button, IconButton } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SIM_STATUS } from "../../_shared/sim-meta";
import { SimNumbers } from "../../_shared/sim-numbers";
import { TrackerActionDialog } from "../../_shared/tracker-actions";
import { EditCustomerDialog, MemberDialog, type MemberAction } from "./customer-dialogs";
import { CustomerPlanCard, type CustomerBilling } from "./customer-plan";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import type { BulkRowStatus, CustomerDetail } from "@/lib/customers";
import { BULK_IMPORT_MAX, isValidImei, parseImeiList, PROBLEM_LABEL } from "@/lib/imei-list";
import { viewAs } from "../_shared/view-as";
import { StatusDialog, type StatusAction } from "../_shared/status-dialog";
import { CUSTOMER_STATUS } from "../_shared/status-meta";
import { RelativeTime } from "@/components/app/local-time";
import { useTime } from "@/components/app/time-context";

const ROLE_LABEL: Record<string, string> = { ORG_ADMIN: "Org Admin", FLEET_MANAGER: "Fleet Manager", DISPATCHER: "Dispatcher", VIEWER: "Viewer" };

export function CustomerDetailView({ c, billing }: { c: CustomerDetail; billing: CustomerBilling }) {
  const time = useTime();
  const router = useRouter();
  const [registering, setRegistering] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [changing, setChanging] = useState<StatusAction | null>(null);
  const [editing, setEditing] = useState(false);
  const [tracker, setTracker] = useState<{ d: CustomerDetail["devices"][number]; action: "move" | "return" } | null>(null);
  const [member, setMember] = useState<MemberAction | null>(null);
  const refresh = () => router.refresh();
  const archived = c.status === "archived";
  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {c.name}
            {c.status !== "active" && <StatusBadge tone={CUSTOMER_STATUS[c.status].tone} label={CUSTOMER_STATUS[c.status].label} className="bg-white" />}
          </span>
        }
        description={`${c.slug} · created ${time.date(c.createdAt)}`}
        breadcrumbs={[{ label: "Customers", href: "/admin/customers" }, { label: c.name }]}
        actions={
          <>
            <Button variant="secondary" onClick={() => viewAs(c.id)}>
              <Eye /> View as customer
            </Button>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil /> Edit details
            </Button>
            {!archived && (
              <>
                <Button variant="secondary" onClick={() => setBulk(true)}>
                  <ListPlus /> Bulk import
                </Button>
                <Button onClick={() => setRegistering(true)}>
                  <Plus /> Add tracker
                </Button>
              </>
            )}
          </>
        }
      />
      {c.status !== "active" && (
        <div className="mb-4">
          <Alert
            tone={archived ? "info" : "warning"}
            title={archived ? "This customer is archived" : "This customer is suspended"}
            action={
              <Button size="sm" variant="secondary" onClick={() => setChanging(archived ? "restore" : "reactivate")}>
                {archived ? <ArchiveRestore /> : <PlayCircle />} {archived ? "Restore" : "Reactivate"}
              </Button>
            }
          >
            {archived ? "Users can't sign in and tracker positions aren't stored. Nothing has been deleted." : "Users can't sign in and no alerts or emails go out. Trackers keep recording."}
            {c.statusReason && <> Reason: {c.statusReason}.</>}
            {c.statusChangedAt && (
              <>
                {" "}
                {c.statusChangedBy ? `${c.statusChangedBy}, ` : ""}
                {time.dateTime(c.statusChangedAt)}.
              </>
            )}
          </Alert>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="h-fit min-w-0">
          <CardHeader>
            <CardTitle>Trackers ({c.devices.length})</CardTitle>
          </CardHeader>
          {c.devices.length === 0 ? (
            <EmptyState
              icon={Cpu}
              title="No trackers yet"
              description="Add a tracker by IMEI: one from RIO stock is handed over, a new one is registered in Traccar. Bulk import takes a whole list."
              action={
                !archived && (
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button size="sm" onClick={() => setRegistering(true)}>
                      <Plus /> Add tracker
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setBulk(true)}>
                      <ListPlus /> Bulk import
                    </Button>
                  </div>
                )
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Tracker</TH>
                    <TH>Vehicle</TH>
                    <TH>SIM</TH>
                    <TH>Last seen</TH>
                    <TH>
                      <span className="sr-only">Actions</span>
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {c.devices.map((d) => (
                    <TR key={d.id}>
                      <TD>
                        <div className="font-medium">{d.name ?? d.model ?? "Tracker"}</div>
                        <div className="font-mono text-xs text-muted-foreground">{d.imei}</div>
                        {d.status !== "active" && <StatusBadge tone="neutral" label={d.status === "retired" ? "Retired" : "Deactivated"} className="mt-1" />}
                      </TD>
                      <TD>{d.vehicleName ?? <span className="text-muted-foreground">Unassigned</span>}</TD>
                      <TD className="text-xs">
                        {d.sim ? (
                          <>
                            <SimNumbers msisdn={d.sim.msisdn} iccid={d.sim.iccid} />
                            {d.sim.status !== "active" && <StatusBadge tone={SIM_STATUS[d.sim.status as keyof typeof SIM_STATUS]?.tone ?? "neutral"} label={SIM_STATUS[d.sim.status as keyof typeof SIM_STATUS]?.label ?? d.sim.status} />}
                          </>
                        ) : (
                          <StatusBadge tone="warning" label="No SIM" />
                        )}
                      </TD>
                      <TD className="whitespace-nowrap">{d.lastSeenAt ? <RelativeTime iso={d.lastSeenAt} /> : "Never"}</TD>
                      <TD className="w-0 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <IconButton label={`Actions for ${d.name ?? d.imei}`} size="icon-sm" variant="ghost">
                              <MoreHorizontal aria-hidden="true" />
                            </IconButton>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onSelect={() => setTracker({ d, action: "move" })}>
                              <ArrowRightLeft aria-hidden="true" /> Move to another customer…
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setTracker({ d, action: "return" })}>
                              <Undo2 aria-hidden="true" /> Return to stock…
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </Card>

        <div className="grid h-fit min-w-0 gap-4">
          <CustomerPlanCard customerId={c.id} customerName={c.name} billing={billing} archived={c.status === "archived"} />
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle>Account details</CardTitle>
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
            </CardHeader>
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 px-4 pb-4 text-sm">
              <dt className="text-muted-foreground">Contact</dt>
              <dd className="m-0 min-w-0">
                {c.contactName || c.contactEmail || c.contactPhone ? (
                  <>
                    {c.contactName && <div className="font-medium">{c.contactName}</div>}
                    {c.contactEmail && (
                      <a href={`mailto:${c.contactEmail}`} className="block break-all">
                        {c.contactEmail}
                      </a>
                    )}
                    {c.contactPhone && <a href={`tel:${c.contactPhone}`}>{c.contactPhone}</a>}
                  </>
                ) : (
                  <span className="text-muted-foreground">Not set</span>
                )}
              </dd>
              <dt className="text-muted-foreground">Time zone</dt>
              <dd className="m-0">{c.timeZone.replace(/_/g, " ")}</dd>
              <dt className="text-muted-foreground">Units</dt>
              <dd className="m-0">
                {c.unitSystem === "imperial" ? "Miles, mph" : "Kilometres, km/h"} · {c.timeFormat === "12h" ? "12-hour clock" : "24-hour clock"}
              </dd>
              {c.notes && (
                <>
                  <dt className="text-muted-foreground">Notes</dt>
                  <dd className="m-0 whitespace-pre-wrap">{c.notes}</dd>
                </>
              )}
            </dl>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle>Users ({c.members.length})</CardTitle>
              {!archived && (
                <Button size="sm" variant="secondary" onClick={() => setMember({ action: "add" })}>
                  <UserPlus /> Add user
                </Button>
              )}
            </CardHeader>
            {c.members.length === 0 ? (
              <EmptyState icon={Users} title="No users" description="Add the customer's administrator; they get an invitation email." />
            ) : (
              <ul className="m-0 list-none divide-y divide-border p-0">
                {c.members.map((m) => (
                  <li key={m.userId} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium">{m.name}</div>
                      <div className="break-all text-xs text-muted-foreground">{m.email}</div>
                      <div className="text-xs text-muted-foreground">
                        {ROLE_LABEL[m.role] ?? m.role} · {m.lastSignInAt ? <>active <RelativeTime iso={m.lastSignInAt} /></> : "never signed in"}
                        {m.twoStep && " · two-step on"}
                      </div>
                    </div>
                    {!archived && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton label={`Actions for ${m.name}`} size="icon-sm" variant="ghost">
                            <MoreHorizontal aria-hidden="true" />
                          </IconButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onSelect={() => setMember({ action: "rename", m })}>
                            <Pencil aria-hidden="true" /> Edit name…
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setMember({ action: "role", m })}>
                            <UserCog aria-hidden="true" /> Change role…
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setMember({ action: "password", m })}>
                            <KeyRound aria-hidden="true" /> Reset password…
                          </DropdownMenuItem>
                          {m.twoStep && (
                            <DropdownMenuItem onSelect={() => setMember({ action: "twostep", m })}>
                              <ShieldOff aria-hidden="true" /> Turn off two-step…
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-danger" onSelect={() => setMember({ action: "remove", m })}>
                            <UserMinus aria-hidden="true" /> Remove from {c.name}…
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="m-0 border-t border-border px-4 py-3 text-xs text-muted-foreground">Every change is recorded in the activity log under your name. Platform admins are never listed here.</p>
          </Card>
        </div>
      </div>
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Customer status</CardTitle>
        </CardHeader>
        <div className="grid gap-3 px-4 pb-4 text-sm sm:grid-cols-2">
          {c.status === "active" ? (
            <StatusOption
              icon={PauseCircle}
              title="Suspend"
              text="For unpaid invoices or a pause: users can't sign in and nothing is sent, but trackers keep recording. Reactivate any time."
              button={<Button variant="secondary" onClick={() => setChanging("suspend")}>Suspend…</Button>}
            />
          ) : c.status === "suspended" ? (
            <StatusOption
              icon={PlayCircle}
              title="Reactivate"
              text="Users can sign in again and alerts, emails and links work as before."
              button={<Button onClick={() => setChanging("reactivate")}>Reactivate…</Button>}
            />
          ) : null}
          {archived ? (
            <StatusOption
              icon={ArchiveRestore}
              title="Restore"
              text="Bring the customer back exactly as it was. Nothing was deleted while it was archived."
              button={<Button onClick={() => setChanging("restore")}>Restore…</Button>}
            />
          ) : (
            <StatusOption
              icon={Archive}
              title="Archive (soft delete)"
              text="When a customer leaves: hidden from the list, users can't sign in and positions are no longer stored. Every record is kept and can be restored."
              button={<Button variant="danger" onClick={() => setChanging("archive")}>Archive…</Button>}
              danger
            />
          )}
        </div>
      </Card>
      {editing && (
        <EditCustomerDialog
          c={c}
          onOpenChange={setEditing}
          onDone={() => {
            setEditing(false);
            refresh();
          }}
        />
      )}
      {member && <MemberDialog customer={c} action={member} onOpenChange={(o) => !o && setMember(null)} onDone={() => refresh()} onClose={() => setMember(null)} />}
      {tracker && (
        <TrackerActionDialog
          action={tracker.action}
          tracker={{ id: tracker.d.id, imei: tracker.d.imei, label: tracker.d.name ?? tracker.d.model ?? "Tracker", customerId: c.id, customerName: c.name }}
          onOpenChange={(o) => !o && setTracker(null)}
          onDone={() => {
            setTracker(null);
            refresh();
          }}
        />
      )}
      {changing && (
        <StatusDialog
          customer={c}
          action={changing}
          onOpenChange={(o) => !o && setChanging(null)}
          onDone={() => {
            setChanging(null);
            router.refresh();
          }}
        />
      )}
      <RegisterDeviceDialog
        open={registering}
        onOpenChange={setRegistering}
        customerId={c.id}
        onDone={() => router.refresh()}
      />
      <BulkImportDialog open={bulk} onOpenChange={setBulk} customerId={c.id} onDone={() => router.refresh()} />
    </>
  );
}

function StatusOption({ icon: Icon, title, text, button, danger }: { icon: typeof Archive; title: string; text: string; button: ReactNode; danger?: boolean }) {
  return (
    <div className={`flex flex-col gap-3 rounded-lg border p-4 ${danger ? "border-danger/30" : "border-border"}`}>
      <div className="flex items-start gap-3">
        <span className={`grid size-9 shrink-0 place-items-center rounded-full ${danger ? "bg-danger-soft text-danger" : "bg-primary-soft text-primary"}`}>
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="m-0 font-semibold">{title}</p>
          <p className="m-0 mt-0.5 text-muted-foreground">{text}</p>
        </div>
      </div>
      <div>{button}</div>
    </div>
  );
}

function RegisterDeviceDialog({ open, onOpenChange, customerId, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; customerId: string; onDone: () => void }) {
  const [imei, setImei] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const digits = imei.replace(/\D/g, "");
  // A real IMEI ends in a check digit. Failing it nearly always means a typo, so ask before sending.
  const unchecked = digits.length === 15 && !isValidImei(digits);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const name = String(f.get("name") ?? "").trim();
      const out = await api<{ traccarCreated: boolean; fromStock: boolean }>(`/api/admin/customers/${customerId}/devices`, {
        method: "POST",
        json: { imei: digits, model: f.get("model"), ...(name ? { name } : {}), ...(unchecked && confirmed ? { allowUncheckedImei: true } : {}) }
      });
      toast.success(out.fromStock ? "Tracker handed over from RIO stock." : out.traccarCreated ? "Tracker registered in Traccar and RIO." : "Tracker already existed in Traccar; linked to this customer.");
      setImei("");
      setConfirmed(false);
      onOpenChange(false);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent title="Add a tracker" description="If the IMEI is in RIO stock, that unit (and its SIM) is handed to this customer. A new IMEI is registered in Traccar first; nothing is saved if Traccar rejects it.">
        <form method="post" onSubmit={submit} className="grid gap-4">
          <Field id="rd-imei" label="IMEI" required description="15 digits, printed on the device label." error={digits.length > 0 && digits.length !== 15 ? `${digits.length} of 15 digits` : null}>
            <Input id="rd-imei" value={imei} onChange={(e) => { setImei(e.target.value); setConfirmed(false); setError(null); }} inputMode="numeric" autoComplete="off" maxLength={20} aria-invalid={digits.length > 0 && digits.length !== 15} autoFocus />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="rd-model" label="Model" required>
              <Input id="rd-model" name="model" defaultValue="FTM880" required maxLength={60} />
            </Field>
            <Field id="rd-name" label="Name" description="Optional, e.g. Truck 7 tracker">
              <Input id="rd-name" name="name" maxLength={80} />
            </Field>
          </div>
          {unchecked && (
            <Alert tone="warning" title="This number does not look like a valid IMEI">
              <p className="m-0">One digit is probably mistyped. Compare all 15 digits with the label on the device. A tracker registered under the wrong number never shows on the map.</p>
              <label className="mt-2 flex cursor-pointer items-start gap-2 text-sm font-medium">
                <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span>I checked it against the label and it matches exactly. Register it anyway.</span>
              </label>
            </Alert>
          )}
          {error && <Alert tone="danger">{error}</Alert>}
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={digits.length !== 15 || (unchecked && !confirmed)}>
              Add tracker
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type BulkResult = { results: { imei: string; status: BulkRowStatus; message?: string }[]; summary: { registered: number; alreadyRegistered: number; otherCustomer: number; invalid: number; failed: number } };

const STATUS_LABEL: Record<BulkRowStatus, string> = {
  registered: "Registered",
  already_registered: "Already registered",
  other_customer: "Another customer's",
  invalid: "Invalid IMEI",
  failed: "Failed"
};

/** Paste a column of IMEIs (optionally with names) and register them all for this customer. */
function BulkImportDialog({ open, onOpenChange, customerId, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; customerId: string; onDone: () => void }) {
  const [text, setText] = useState("");
  const [model, setModel] = useState("FTM880");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const { rows, problems } = parseImeiList(text);
  const tooMany = rows.length > BULK_IMPORT_MAX;

  function close(o: boolean) {
    if (busy) return;
    onOpenChange(o);
    if (!o) {
      if (result) onDone();
      setText("");
      setResult(null);
      setError(null);
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const out = await api<BulkResult>(`/api/admin/customers/${customerId}/devices/bulk`, {
        method: "POST",
        json: { model, rows: rows.map((r) => ({ imei: r.imei, ...(r.name ? { name: r.name } : {}) })) }
      });
      setResult(out);
      const s = out.summary;
      if (s.registered > 0) toast.success(`${s.registered} tracker${s.registered === 1 ? "" : "s"} registered.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const needsAttention = result?.results.filter((r) => r.status !== "registered" && r.status !== "already_registered") ?? [];

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent title="Bulk import trackers" description="Paste one tracker per line: the IMEI, and optionally a name after a comma or tab. A column copied from a spreadsheet works as is.">
        {result ? (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label="Registered" value={result.summary.registered} tone="good" />
              <Stat label="Already registered" value={result.summary.alreadyRegistered} />
              <Stat label="Need attention" value={result.summary.otherCustomer + result.summary.invalid + result.summary.failed} tone={needsAttention.length ? "bad" : undefined} />
            </div>
            {needsAttention.length > 0 && (
              <div className="max-h-56 overflow-y-auto rounded-md border border-border">
                <Table>
                  <THead>
                    <TR>
                      <TH>IMEI</TH>
                      <TH>Result</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {needsAttention.map((r) => (
                      <TR key={r.imei}>
                        <TD className="font-mono text-xs">{r.imei}</TD>
                        <TD>
                          <div className="text-sm font-medium">{STATUS_LABEL[r.status]}</div>
                          {r.message && <div className="text-xs text-muted-foreground">{r.message}</div>}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
            <p className="m-0 text-sm text-muted-foreground">
              Next: add the same IMEIs to your FOTA WEB group so each tracker gets its settings on first power-on, then assign trackers to vehicles under Vehicles.
            </p>
            <DialogFooter>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form method="post" onSubmit={submit} className="grid gap-4">
            <Field id="bi-list" label="Trackers" required description={`Up to ${BULK_IMPORT_MAX} per import. Lines with no digits (such as a header) are skipped.`}>
              <Textarea
                id="bi-list"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setError(null);
                }}
                rows={8}
                spellCheck={false}
                autoFocus
                placeholder={"864361078566024, Truck 12\n864361078566115, Trailer 3"}
                className="font-mono"
              />
            </Field>
            <Field id="bi-model" label="Model" required description="Applied to every tracker in this import.">
              <Input id="bi-model" value={model} onChange={(e) => setModel(e.target.value)} required maxLength={60} />
            </Field>
            {(rows.length > 0 || problems.length > 0) && (
              <div className="rounded-md bg-muted px-3 py-2 text-sm" aria-live="polite">
                <span className="font-medium">{rows.length} ready</span>
                {problems.length > 0 && <span className="text-muted-foreground"> · {problems.length} skipped</span>}
              </div>
            )}
            {problems.length > 0 && (
              <Alert tone="warning" title={`${problems.length} line${problems.length === 1 ? "" : "s"} will be skipped`}>
                <ul className="m-0 max-h-28 list-none overflow-y-auto p-0 text-sm">
                  {problems.slice(0, 50).map((p) => (
                    <li key={p.line}>
                      Line {p.line}: <span className="font-mono">{p.text.slice(0, 40)}</span> {PROBLEM_LABEL[p.reason]}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
            {tooMany && <Alert tone="danger">That is {rows.length} trackers; import at most {BULK_IMPORT_MAX} at a time.</Alert>}
            {error && <Alert tone="danger">{error}</Alert>}
            <DialogFooter>
              <Button variant="secondary" onClick={() => close(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" loading={busy} disabled={rows.length === 0 || tooMany || !model.trim()}>
                {busy ? `Registering ${rows.length}…` : `Register ${rows.length || ""} tracker${rows.length === 1 ? "" : "s"}`}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className={tone === "good" ? "text-xl font-semibold text-success" : tone === "bad" ? "text-xl font-semibold text-danger" : "text-xl font-semibold"}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
