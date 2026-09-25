"use client";
import { CalendarCheck, History, MoreHorizontal, Plus, Trash2, Wrench } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { SegmentedFilter } from "@/components/app/filter-bar";
import { PageHeader } from "@/components/app/page-header";
import { SearchInput } from "@/components/app/search-input";
import { EmptyState } from "@/components/app/states";
import { StatusBadge, type StatusTone } from "@/components/app/status-badge";
import { useUnits } from "@/components/app/units-context";
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
import type { ItemDto } from "@/lib/maintenance";

type Opt = { id: string; label: string };
type Filter = "all" | "overdue" | "due_soon" | "ok";
const STATE: Record<string, { tone: StatusTone; label: string }> = {
  ok: { tone: "success", label: "OK" },
  due_soon: { tone: "warning", label: "Due soon" },
  overdue: { tone: "danger", label: "Overdue" }
};
const PRESETS = [
  { name: "Oil change", km: 16_093, days: 180 }, // 10,000 mi
  { name: "Tire rotation", km: 12_070, days: null }, // 7,500 mi
  { name: "Brake inspection", km: 32_187, days: 365 }, // 20,000 mi
  { name: "Annual DOT inspection", km: null, days: 365 },
  { name: "Registration renewal", km: null, days: 365 }
];
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

export function MaintenanceManager(props: { initial: ItemDto[]; vehicles: Opt[]; members: Opt[]; myUserId: string; canWrite: boolean }) {
  const u = useUnits();
  const router = useRouter();
  const [items, setItems] = useState(props.initial);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [servicing, setServicing] = useState<ItemDto | null>(null);
  const [deleting, setDeleting] = useState<ItemDto | null>(null);

  async function refresh() {
    setItems((await api<{ items: ItemDto[] }>("/api/maintenance")).items);
    router.refresh(); // dashboard badge / sidebar counts
  }

  const counts = useMemo(() => {
    const c = { all: items.length, overdue: 0, due_soon: 0, ok: 0 };
    for (const i of items) c[i.status.state]++;
    return c;
  }, [items]);
  const q = search.trim().toLowerCase();
  const shown = items.filter((i) => (filter === "all" || i.status.state === filter) && (!q || i.vehicleName.toLowerCase().includes(q) || i.name.toLowerCase().includes(q)));
  const byVehicle = useMemo(() => {
    const m = new Map<string, ItemDto[]>();
    for (const i of shown) m.set(i.vehicleName, [...(m.get(i.vehicleName) ?? []), i]);
    return [...m.entries()];
  }, [shown]);

  const every = (i: ItemDto) => [i.intervalKm ? u.fmtDist(i.intervalKm, 0) : null, i.intervalDays ? `${i.intervalDays} days` : null].filter(Boolean).join(" or ");
  const remaining = (i: ItemDto) => {
    const s = i.status;
    const parts: string[] = [];
    if (s.kmRemaining !== null) parts.push(s.kmRemaining <= 0 ? `${u.fmtDist(Math.abs(s.kmRemaining), 0)} over` : `${u.fmtDist(s.kmRemaining, 0)} left`);
    if (s.daysRemaining !== null) parts.push(s.daysRemaining <= 0 ? `due ${s.dueDate}` : `${s.daysRemaining} days left`);
    return parts.join(" · ");
  };

  return (
    <>
      <PageHeader
        title="Maintenance"
        description="Service reminders by distance or date. Distance is measured from GPS since the last service (driving only)."
        actions={
          props.canWrite && (
            <Button onClick={() => setAdding(true)} disabled={props.vehicles.length === 0}>
              <Plus /> Add reminder
            </Button>
          )
        }
      />

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={Wrench}
            title="No maintenance reminders yet"
            description={props.vehicles.length === 0 ? "Add a vehicle first, then set reminders like oil changes or inspections." : "Add reminders like oil changes, tire rotations or annual inspections, and get an email when they come due."}
            action={
              props.canWrite &&
              props.vehicles.length > 0 && (
                <Button size="sm" onClick={() => setAdding(true)}>
                  <Plus /> Add reminder
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <SearchInput value={search} onChange={setSearch} placeholder="Search vehicle or service…" label="Search reminders" className="sm:w-64" debounceMs={100} />
            <SegmentedFilter<Filter>
              label="Filter by status"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All", count: counts.all },
                { value: "overdue", label: "Overdue", count: counts.overdue },
                { value: "due_soon", label: "Due soon", count: counts.due_soon },
                { value: "ok", label: "OK", count: counts.ok }
              ]}
            />
          </div>
          {byVehicle.length === 0 ? (
            <Card>
              <EmptyState title="Nothing matches these filters" />
            </Card>
          ) : (
            <div className="grid gap-4">
              {byVehicle.map(([vehicle, list]) => (
                <Card key={vehicle}>
                  <div className="border-b border-border px-4 py-3">
                    <h2 className="m-0 text-[15px] font-semibold">{vehicle}</h2>
                  </div>
                  <ul className="m-0 list-none divide-y divide-border p-0">
                    {list.map((i) => (
                      <li key={i.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge tone={STATE[i.status.state]!.tone} label={STATE[i.status.state]!.label} />
                            <span className="font-medium">{i.name}</span>
                            <span className="text-xs text-muted-foreground">every {every(i)}</span>
                          </div>
                          <div className={cn("mt-1 text-sm", i.status.state === "overdue" ? "text-danger" : "text-foreground")}>{remaining(i)}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {u.fmtDist(i.status.kmSinceService)} since last service on {new Date(i.lastServiceAt).toLocaleDateString()}
                            {i.lastServiceOdometerKm !== null ? ` (odometer ${u.fmtDist(i.lastServiceOdometerKm, 0)})` : ""}
                          </div>
                          {i.note && <div className="mt-0.5 text-xs text-muted-foreground">{i.note}</div>}
                          {i.history.length > 0 && (
                            <details className="mt-1 text-xs">
                              <summary className="inline-flex cursor-pointer items-center gap-1 text-muted-foreground">
                                <History className="size-3.5" aria-hidden="true" /> Service history ({i.history.length})
                              </summary>
                              <ul className="m-0 mt-1 grid gap-0.5 pl-5">
                                {i.history.map((h) => (
                                  <li key={h.servicedAt}>
                                    {new Date(h.servicedAt).toLocaleDateString()}
                                    {h.kmSincePrevious !== null ? ` · ${u.fmtDist(h.kmSincePrevious, 0)} since previous` : ""}
                                    {h.odometerKm !== null ? ` · odometer ${u.fmtDist(h.odometerKm, 0)}` : ""}
                                    {h.note ? ` · ${h.note}` : ""}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </div>
                        {props.canWrite && (
                          <div className="flex shrink-0 gap-2">
                            <Button size="sm" variant={i.status.state === "ok" ? "secondary" : "primary"} onClick={() => setServicing(i)}>
                              <CalendarCheck /> Mark serviced
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${i.name}`}>
                                  <MoreHorizontal />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent>
                                <DropdownMenuItem destructive onSelect={() => setDeleting(i)}>
                                  <Trash2 /> Delete reminder
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {props.canWrite && (
        <>
          <AddReminderDialog
            open={adding}
            onOpenChange={setAdding}
            vehicles={props.vehicles}
            members={props.members}
            myUserId={props.myUserId}
            onCreated={async () => {
              toast.success("Reminder added.");
              await refresh();
            }}
          />
          <ServiceDialog
            item={servicing}
            onClose={() => setServicing(null)}
            onDone={async () => {
              toast.success("Service recorded. The interval starts again.");
              await refresh();
            }}
          />
        </>
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.name ?? ""}" for ${deleting?.vehicleName ?? ""}?`}
        description="Its service history is deleted too."
        confirmLabel="Delete reminder"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          await api(`/api/maintenance/${deleting.id}`, { method: "DELETE" });
          setDeleting(null);
          toast.success("Reminder deleted.");
          await refresh();
        }}
      />
    </>
  );
}

function AddReminderDialog({ open, onOpenChange, vehicles, members, myUserId, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; vehicles: Opt[]; members: Opt[]; myUserId: string; onCreated: () => Promise<void> }) {
  const u = useUnits();
  const [preset, setPreset] = useState<(typeof PRESETS)[number] | null>(PRESETS[0]!);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const num = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? null : Number(v));
  const round = (n: number) => Math.round(n / 500) * 500;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const dist = num(f.get("interval"));
    const odo = num(f.get("odometer"));
    setBusy(true);
    setError(null);
    try {
      await api("/api/maintenance", {
        method: "POST",
        json: {
          vehicleId: f.get("vehicleId"),
          name: f.get("name"),
          // Entered in the organization's unit; stored in km.
          intervalKm: dist === null ? null : Math.round(u.toKm(dist)),
          intervalDays: num(f.get("intervalDays")),
          lastServiceAt: new Date(`${f.get("lastServiceAt")}T12:00:00`).toISOString(),
          lastServiceOdometerKm: odo === null ? null : Math.round(u.toKm(odo)),
          notifyUserIds: f.getAll("notify").map(String),
          note: String(f.get("note") ?? "").trim() || null
        }
      });
      onOpenChange(false);
      await onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent title="Add maintenance reminder" description="Due by distance, by date, or both, whichever comes first.">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <Button key={p.name} size="sm" variant={preset?.name === p.name ? "primary" : "secondary"} onClick={() => setPreset(p)}>
              {p.name}
            </Button>
          ))}
          <Button size="sm" variant={preset === null ? "primary" : "secondary"} onClick={() => setPreset(null)}>
            Custom
          </Button>
        </div>
        <form method="post" onSubmit={submit} className="grid gap-4" key={preset?.name ?? "custom"}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="m-vehicle" label="Vehicle" required>
              <Select id="m-vehicle" name="vehicleId" required>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="m-name" label="Service" required>
              <Input id="m-name" name="name" required maxLength={120} defaultValue={preset?.name ?? ""} />
            </Field>
            <Field id="m-int" label={`Every … ${u.distance}`} description="Leave empty for date only">
              <Input id="m-int" name="interval" type="number" min={1} defaultValue={preset?.km ? round(u.dist(preset.km)) : ""} />
            </Field>
            <Field id="m-days" label="and/or every … days" description="Leave empty for distance only">
              <Input id="m-days" name="intervalDays" type="number" min={1} max={3650} defaultValue={preset?.days ?? ""} />
            </Field>
            <Field id="m-last" label="Last service date" required>
              <Input id="m-last" name="lastServiceAt" type="date" required defaultValue={today()} max={today()} />
            </Field>
            <Field id="m-odo" label={`Odometer then (${u.distance})`} description="Optional, for your records">
              <Input id="m-odo" name="odometer" type="number" min={0} />
            </Field>
          </div>
          {members.length > 0 && (
            <fieldset className="m-0 grid gap-1.5 border-0 p-0">
              <legend className="mb-1 text-sm font-medium">Email when due soon or overdue</legend>
              <div className="grid max-h-36 gap-1.5 overflow-auto rounded-md border border-border p-2">
                {members.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm">
                    <Checkbox name="notify" value={m.id} defaultChecked={m.id === myUserId} /> {m.label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <Field id="m-note" label="Note">
            <Input id="m-note" name="note" maxLength={500} placeholder="Optional" />
          </Field>
          {error && <Alert tone="danger">{error}</Alert>}
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Add reminder
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ServiceDialog({ item, onClose, onDone }: { item: ItemDto | null; onClose: () => void; onDone: () => Promise<void> }) {
  const u = useUnits();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={item !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      {item && (
        <DialogContent title={`Mark "${item.name}" serviced`} description={`${item.vehicleName}. The reminder starts counting again from this date.`}>
          <form
            method="post"
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const d = String(f.get("servicedAt") ?? "");
              const odo = String(f.get("odometer") ?? "").trim();
              setBusy(true);
              setError(null);
              try {
                await api(`/api/maintenance/${item.id}/service`, {
                  method: "POST",
                  json: {
                    servicedAt: d === today() ? undefined : new Date(`${d}T12:00:00`).toISOString(),
                    odometerKm: odo ? Math.round(u.toKm(Number(odo))) : null,
                    note: String(f.get("note") ?? "").trim() || null
                  }
                });
                onClose();
                await onDone();
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="s-date" label="Service date" required>
                <Input id="s-date" type="date" name="servicedAt" required defaultValue={today()} max={today()} />
              </Field>
              <Field id="s-odo" label={`Odometer (${u.distance})`} description="Optional">
                <Input id="s-odo" type="number" name="odometer" min={0} />
              </Field>
            </div>
            <Field id="s-note" label="Note">
              <Input id="s-note" name="note" maxLength={500} placeholder="e.g. Synthetic 5W-30, filter replaced" />
            </Field>
            {error && <Alert tone="danger">{error}</Alert>}
            <DialogFooter>
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" loading={busy}>
                Save service
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
