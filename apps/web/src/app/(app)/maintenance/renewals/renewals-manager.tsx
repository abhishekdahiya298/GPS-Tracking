"use client";
/**
 * Renewal reminders: registration, insurance, inspection, permits… with a fixed expiry
 * date. The server computes the state from the organization's calendar day and re-checks
 * permissions and ownership on every change.
 */
import { RENEWAL_TYPES, RENEWAL_TYPE_LABEL, renewalDueText, type RenewalType } from "@rio-gps/core/renewals";
import { addDays } from "@rio-gps/core/timezones";
import { CalendarClock, CalendarPlus, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { SegmentedFilter } from "@/components/app/filter-bar";
import { PageHeader } from "@/components/app/page-header";
import { SearchInput } from "@/components/app/search-input";
import { EmptyState } from "@/components/app/states";
import { StatusBadge, type StatusTone } from "@/components/app/status-badge";
import { useTime } from "@/components/app/time-context";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import type { RenewalDto } from "@/lib/renewals";
import { MaintenanceTabs } from "../maintenance-tabs";

type Opt = { id: string; label: string };
type Filter = "all" | "overdue" | "due_soon" | "ok";
const STATE: Record<string, { tone: StatusTone; label: string }> = {
  ok: { tone: "success", label: "OK" },
  due_soon: { tone: "warning", label: "Due soon" },
  overdue: { tone: "danger", label: "Expired" }
};
/** The next day key one year after `day` (Feb 29 → Feb 28). */
const plusYear = (day: string) => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y + 1, m - 1, d, 12));
  if (next.getUTCMonth() !== m - 1) next.setUTCDate(0);
  return next.toISOString().slice(0, 10);
};

export function RenewalsManager(props: { initial: RenewalDto[]; vehicles: Opt[]; members: Opt[]; myUserId: string; canWrite: boolean }) {
  const time = useTime();
  const router = useRouter();
  const [items, setItems] = useState(props.initial);
  useEffect(() => setItems(props.initial), [props.initial]);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<RenewalDto | "new" | null>(null);
  const [renewing, setRenewing] = useState<RenewalDto | null>(null);
  const [deleting, setDeleting] = useState<RenewalDto | null>(null);

  const reload = async () => {
    try {
      setItems((await api<{ renewals: RenewalDto[] }>("/api/renewals")).renewals);
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const counts = useMemo(() => {
    const c = { all: items.length, overdue: 0, due_soon: 0, ok: 0 };
    for (const i of items) c[i.status.state]++;
    return c;
  }, [items]);
  const q = search.trim().toLowerCase();
  const shown = items.filter(
    (i) => (filter === "all" || i.status.state === filter) && (!q || i.title.toLowerCase().includes(q) || (i.vehicleName ?? "company").toLowerCase().includes(q) || RENEWAL_TYPE_LABEL[i.type].toLowerCase().includes(q))
  );
  // A due date is a calendar day, not an instant: format the day key directly.
  const day = (key: string) => `${time.day(key)}, ${key.slice(0, 4)}`;

  return (
    <>
      <PageHeader
        title="Maintenance"
        description="Renewals with a fixed expiry date: registration, insurance, inspections and permits."
        actions={
          props.canWrite && (
            <Button onClick={() => setEditing("new")}>
              <Plus /> Add renewal
            </Button>
          )
        }
      />
      <MaintenanceTabs active="renewals" renewalsDue={counts.overdue + counts.due_soon} />

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarClock}
            title="No renewals yet"
            description="Track plate registration, insurance, safety inspections and permits, and get an email before they expire."
            action={
              props.canWrite && (
                <Button size="sm" onClick={() => setEditing("new")}>
                  <Plus /> Add renewal
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <SearchInput value={search} onChange={setSearch} placeholder="Search vehicle or renewal…" label="Search renewals" className="sm:w-64" debounceMs={100} />
            <SegmentedFilter<Filter>
              label="Filter by status"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All", count: counts.all },
                { value: "overdue", label: "Expired", count: counts.overdue },
                { value: "due_soon", label: "Due soon", count: counts.due_soon },
                { value: "ok", label: "OK", count: counts.ok }
              ]}
            />
          </div>
          <Card>
            {shown.length === 0 ? (
              <EmptyState title="Nothing matches these filters" />
            ) : (
              <ul className="m-0 list-none divide-y divide-border p-0">
                {shown.map((i) => (
                  <li key={i.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone={STATE[i.status.state]!.tone} label={STATE[i.status.state]!.label} />
                        <span className="font-medium">{i.title}</span>
                        <span className="text-xs text-muted-foreground">{RENEWAL_TYPE_LABEL[i.type]}</span>
                      </div>
                      <div className={cn("mt-1 text-sm", i.status.state === "overdue" ? "text-danger" : "text-foreground")}>
                        {i.status.state === "overdue" ? "Expired" : "Expires"} {renewalDueText(i.status.daysRemaining)} · {day(i.dueDate)}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {i.vehicleName ?? "Whole company"} · reminder {i.remindDays} days before
                        {i.note ? ` · ${i.note}` : ""}
                      </div>
                    </div>
                    {props.canWrite && (
                      <div className="flex shrink-0 gap-2">
                        <Button size="sm" variant={i.status.state === "ok" ? "secondary" : "primary"} onClick={() => setRenewing(i)}>
                          <CalendarPlus /> Mark renewed
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="ghost" aria-label={`More actions for ${i.title}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onSelect={() => setEditing(i)}>
                              <Pencil /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setDeleting(i)}>
                              <Trash2 /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      {editing !== null && <RenewalDialog key={editing === "new" ? "new" : editing.id} item={editing === "new" ? null : editing} vehicles={props.vehicles} members={props.members} myUserId={props.myUserId} onClose={() => setEditing(null)} onSaved={reload} />}

      {renewing && (
        <RenewDialog
          item={renewing}
          suggested={plusYear(renewing.dueDate)}
          onClose={() => setRenewing(null)}
          onSaved={reload}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.title ?? ""}?`}
        description="The reminder is removed. Nothing else changes."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          try {
            await api(`/api/renewals/${deleting!.id}`, { method: "DELETE" });
            toast.success("Renewal deleted.");
            await reload();
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
    </>
  );
}

function RenewalDialog({ item, vehicles, members, myUserId, onClose, onSaved }: { item: RenewalDto | null; vehicles: Opt[]; members: Opt[]; myUserId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const time = useTime();
  const today = time.dayKey(Date.now());
  const [type, setType] = useState<RenewalType>(item?.type ?? "registration");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const json = {
      vehicleId: String(f.get("vehicleId") ?? "") || null,
      type,
      title: String(f.get("title") ?? "").trim(),
      dueDate: String(f.get("dueDate") ?? ""),
      remindDays: Number(f.get("remindDays")),
      notifyUserIds: f.getAll("notify").map(String),
      note: String(f.get("note") ?? "").trim() || null
    };
    setBusy(true);
    setError(null);
    try {
      if (item) await api(`/api/renewals/${item.id}`, { method: "PATCH", json });
      else await api("/api/renewals", { method: "POST", json });
      toast.success(item ? "Renewal saved." : "Renewal added.");
      onClose();
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent title={item ? "Edit renewal" : "Add renewal"} description="You'll see it turn to “Due soon” before the date, and get an email if you choose recipients.">
        <form method="post" onSubmit={submit} className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="r-type" label="Type" required>
              <Select id="r-type" value={type} onChange={(e) => setType(e.target.value as RenewalType)}>
                {RENEWAL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {RENEWAL_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="r-vehicle" label="Applies to">
              <Select id="r-vehicle" name="vehicleId" defaultValue={item?.vehicleId ?? ""}>
                <option value="">Whole company</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="r-title" label="Name" required className="sm:col-span-2">
              <Input id="r-title" name="title" required maxLength={120} defaultValue={item?.title ?? ""} placeholder={type === "insurance" ? "e.g. Fleet insurance policy" : type === "registration" ? "e.g. Plate sticker" : "What needs renewing"} />
            </Field>
            <Field id="r-due" label="Expires on" required description="The last day it is valid.">
              <Input id="r-due" name="dueDate" type="date" required defaultValue={item?.dueDate ?? addDays(today, 30)} min="2000-01-01" max="2100-12-31" />
            </Field>
            <Field id="r-remind" label="Remind me" required>
              <Select id="r-remind" name="remindDays" defaultValue={String(item?.remindDays ?? 30)}>
                {[...new Set([7, 14, 30, 45, 60, 90, item?.remindDays ?? 30])]
                  .sort((a, b) => a - b)
                  .map((d) => (
                    <option key={d} value={d}>
                      {d} days before
                    </option>
                  ))}
              </Select>
            </Field>
          </div>
          {members.length > 0 && (
            <fieldset className="m-0 grid gap-1.5 border-0 p-0">
              <legend className="mb-1 text-sm font-medium">Email when due soon or expired</legend>
              <div className="grid max-h-36 gap-1.5 overflow-auto rounded-md border border-border p-2">
                {members.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm">
                    <Checkbox name="notify" value={m.id} defaultChecked={item ? item.notifyUserIds.includes(m.id) : m.id === myUserId} /> {m.label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <Field id="r-note" label="Note">
            <Input id="r-note" name="note" maxLength={500} placeholder="Optional, e.g. policy number" defaultValue={item?.note ?? ""} />
          </Field>
          {error && <Alert tone="danger">{error}</Alert>}
          <DialogFooter>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              {item ? "Save" : "Add renewal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RenewDialog({ item, suggested, onClose, onSaved }: { item: RenewalDto; suggested: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent title={`${item.title} renewed`} description="Enter the new expiry date. Reminders start over for the new date.">
        <form
          method="post"
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await api(`/api/renewals/${item.id}/renew`, { method: "POST", json: { dueDate: String(new FormData(e.currentTarget).get("dueDate") ?? "") } });
              toast.success("Marked as renewed.");
              onClose();
              await onSaved();
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field id="rn-due" label="New expiry date" required description={`Currently ${item.dueDate}. Suggested: one year later.`}>
            <Input id="rn-due" name="dueDate" type="date" required defaultValue={suggested} min={addDays(item.dueDate, 1)} max="2100-12-31" />
          </Field>
          {error && <Alert tone="danger">{error}</Alert>}
          <DialogFooter>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              <CalendarPlus /> Save new date
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
