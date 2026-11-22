"use client";
import { AlertTriangle, CalendarCheck, Check, CheckCircle2, ChevronDown, ChevronRight, Clock, History, Layers, Plus, Trash2, Wrench, X } from "lucide-react";
import { FilterTiles } from "@/components/app/list-kit";
import { VehiclePicture } from "@/components/app/vehicle-picture";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { SegmentedFilter } from "@/components/app/filter-bar";
import { PageHeader } from "@/components/app/page-header";
import { SearchInput } from "@/components/app/search-input";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { wallTimeToUtc } from "@rio-gps/core/timezones";
import { useTime } from "@/components/app/time-context";
import { useUnits } from "@/components/app/units-context";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import type { ItemDto } from "@/lib/maintenance";
import { MaintenanceTabs } from "./maintenance-tabs";

type Opt = { id: string; label: string };
type VehicleOpt = Opt & { type?: string; detail?: string | null; odometerKm?: number | null };
const COLOR = { overdue: "#b91c1c", due_soon: "#c2410c", ok: "#15803d" } as const;
const RANK = { overdue: 0, due_soon: 1, ok: 2 } as const;
/** How far through its interval a service is (0–100), by distance or date, whichever is further. */
function used(i: ItemDto) {
  const a = i.intervalKm ? (i.status.kmSinceService / i.intervalKm) * 100 : 0;
  const b = i.intervalDays && i.status.daysRemaining !== null ? ((i.intervalDays - i.status.daysRemaining) / i.intervalDays) * 100 : 0;
  return Math.min(100, Math.max(3, a, b));
}
type Filter = "all" | "overdue" | "due_soon" | "ok";
const PRESETS = [
  { name: "Oil change", km: 16_093, days: 180 }, // 10,000 mi
  { name: "Tire rotation", km: 12_070, days: null }, // 7,500 mi
  { name: "Brake inspection", km: 32_187, days: 365 }, // 20,000 mi
  { name: "Annual DOT inspection", km: null, days: 365 },
  { name: "Registration renewal", km: null, days: 365 }
];

export function MaintenanceManager(props: { initial: ItemDto[]; vehicles: VehicleOpt[]; members: Opt[]; myUserId: string; canWrite: boolean; renewalsDue?: number }) {
  const u = useUnits();
  const time = useTime();
  const router = useRouter();
  const [items, setItems] = useState(props.initial);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [servicing, setServicing] = useState<ItemDto | null>(null);
  const [deleting, setDeleting] = useState<ItemDto | null>(null);
  const [view, setView] = useState<"vehicle" | "all">("vehicle");
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [recordId, setRecordId] = useState<string | null>(null);
  const [addFor, setAddFor] = useState<string | null>(null);

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
  // One group per vehicle, most urgent first; inside a vehicle, most urgent service first.
  const byVehicle = useMemo(() => {
    const m = new Map<string, ItemDto[]>();
    for (const i of shown) m.set(i.vehicleId, [...(m.get(i.vehicleId) ?? []), i]);
    return [...m.entries()]
      .map(([vehicleId, list]) => {
        const sorted = [...list].sort((a, b) => RANK[a.status.state] - RANK[b.status.state] || used(b) - used(a));
        return { vehicleId, name: list[0]!.vehicleName, list: sorted, worst: sorted[0]! };
      })
      .sort((a, b) => RANK[a.worst.status.state] - RANK[b.worst.status.state] || a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [shown]);
  const vehicleById = useMemo(() => new Map(props.vehicles.map((v) => [v.id, v])), [props.vehicles]);
  const record = items.find((i) => i.id === recordId) ?? null;
  // The most urgent vehicle starts open, so the page shows what needs doing first.
  const firstOpen = byVehicle[0]?.vehicleId;
  const isOpen = (id: string) => open.has(id) || (open.size === 0 && id === firstOpen);
  const toggle = (id: string) =>
    setOpen((cur) => {
      const n = new Set(cur.size === 0 && firstOpen ? [firstOpen] : cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const dueText = (i: ItemDto) => {
    const s = i.status;
    if (s.state === "overdue") return s.daysRemaining !== null && s.daysRemaining <= 0 ? `${-s.daysRemaining || 0} days overdue` : s.kmRemaining !== null ? `${u.fmtDist(Math.abs(s.kmRemaining), 0)} overdue` : "Overdue";
    const parts = [s.kmRemaining !== null ? `in ${u.fmtDist(s.kmRemaining, 0)}` : null, s.daysRemaining !== null ? `in ${s.daysRemaining} days` : null].filter(Boolean);
    return parts.join(" or ");
  };

  const every = (i: ItemDto) => [i.intervalKm ? u.fmtDist(i.intervalKm, 0) : null, i.intervalDays ? `${i.intervalDays} days` : null].filter(Boolean).join(" or ");
  const remaining = (i: ItemDto) => {
    const s = i.status;
    const parts: string[] = [];
    if (s.kmRemaining !== null) parts.push(s.kmRemaining <= 0 ? `${u.fmtDist(Math.abs(s.kmRemaining), 0)} over` : `${u.fmtDist(s.kmRemaining, 0)} left`);
    if (s.daysRemaining !== null) parts.push(
        s.daysRemaining <= 0
          ? `${s.daysRemaining === 0 ? "due today" : `${-s.daysRemaining} day${s.daysRemaining === -1 ? "" : "s"} overdue`}${s.dueDate ? ` (${time.day(s.dueDate)}, ${s.dueDate.slice(0, 4)})` : ""}`
          : `${s.daysRemaining} day${s.daysRemaining === 1 ? "" : "s"} left`
      );
    return parts.join(" · ");
  };

  return (
    <>
      <PageHeader
        title="Maintenance"
        description="Every service for every vehicle. We count the miles from GPS and remind you before it's due."
        actions={
          props.canWrite && (
            <Button onClick={() => setAdding(true)} disabled={props.vehicles.length === 0}>
              <Plus /> Add service
            </Button>
          )
        }
      />
      <MaintenanceTabs active="service" renewalsDue={props.renewalsDue} />

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
          <FilterTiles<Filter>
            label="Filter by status"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All services", count: counts.all, icon: Layers, color: "#133a8f" },
              { value: "overdue", label: "Overdue", count: counts.overdue, icon: AlertTriangle, color: "#b91c1c" },
              { value: "due_soon", label: "Due soon", count: counts.due_soon, icon: Clock, color: "#c2410c" },
              { value: "ok", label: "Up to date", count: counts.ok, icon: CheckCircle2, color: "#15803d" }
            ]}
          />
          <Card className="min-w-0 overflow-hidden">
            <div className="flex flex-col gap-2 border-b border-border px-4 py-2.5 sm:flex-row sm:flex-wrap sm:items-center">
              <SegmentedFilter<"vehicle" | "all">
                label="View"
                value={view}
                onChange={setView}
                options={[
                  { value: "vehicle", label: "By vehicle" },
                  { value: "all", label: "All services" }
                ]}
              />
              <SearchInput value={search} onChange={setSearch} placeholder="Search vehicle or service…" label="Search services" className="sm:w-72" debounceMs={100} />
              <span className="text-xs text-muted-foreground sm:ml-auto">Most urgent first · distance from GPS since the last service</span>
            </div>
            {byVehicle.length === 0 ? (
              <EmptyState title="Nothing matches these filters" />
            ) : view === "vehicle" ? (
              <ul className="m-0 list-none divide-y divide-border p-0">
                {byVehicle.map(({ vehicleId, name, list, worst }) => {
                  const v = vehicleById.get(vehicleId);
                  const expanded = isOpen(vehicleId);
                  const c = (k: keyof typeof COLOR) => list.filter((i) => i.status.state === k).length;
                  return (
                    <li key={vehicleId} className={cn(expanded && "bg-primary-soft/40")}>
                      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                        <button type="button" aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} services for ${name}`} onClick={() => toggle(vehicleId)} className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-muted-foreground hover:bg-muted">
                          {expanded ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
                        </button>
                        <button type="button" onClick={() => toggle(vehicleId)} className="flex min-w-[14rem] flex-1 cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left">
                          <VehiclePicture type={v?.type} state={worst.status.state === "overdue" ? "stopped" : worst.status.state === "due_soon" ? "idle" : "moving"} className="h-8 w-12 shrink-0" />
                          <span className="grid min-w-0">
                            <b className="truncate text-sm text-foreground">{name}</b>
                            <span className="truncate text-xs text-muted-foreground">{[v?.detail, v?.odometerKm != null ? `odometer ${u.fmtDist(v.odometerKm, 0)}` : null].filter(Boolean).join(" · ") || `${list.length} service${list.length === 1 ? "" : "s"}`}</span>
                          </span>
                        </button>
                        <span className="flex flex-wrap gap-1">
                          {c("overdue") > 0 && <StatusBadge tone="danger" label={`${c("overdue")} overdue`} />}
                          {c("due_soon") > 0 && <StatusBadge tone="warning" label={`${c("due_soon")} due soon`} />}
                          {c("ok") > 0 && <StatusBadge tone="neutral" label={`${c("ok")} OK`} />}
                        </span>
                        <button type="button" onClick={() => setRecordId(worst.id)} className="flex min-w-[11rem] cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left">
                          <span className="grid size-7 shrink-0 place-items-center rounded-lg text-white" style={{ background: COLOR[worst.status.state] }}>
                            <Wrench className="size-3.5" aria-hidden="true" />
                          </span>
                          <span className="grid min-w-0 leading-tight">
                            <b className="truncate text-[13px] text-foreground">{worst.name}</b>
                            <span className="text-xs font-semibold" style={{ color: COLOR[worst.status.state] }}>
                              {dueText(worst)}
                            </span>
                          </span>
                        </button>
                        {props.canWrite && (
                          <Button size="icon-sm" variant="secondary" aria-label={`Add a service for ${name}`} title="Add a service" onClick={() => { setAddFor(vehicleId); setAdding(true); }}>
                            <Plus />
                          </Button>
                        )}
                      </div>
                      {expanded && (
                        <ul className="m-0 grid list-none gap-1.5 px-4 pb-3 pl-14">
                          {list.map((i) => (
                            <ServiceRow key={i.id} i={i} active={i.id === recordId} every={every(i)} due={dueText(i)} canWrite={props.canWrite} onOpen={() => setRecordId(i.id)} onDone={() => setServicing(i)} />
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <ul className="m-0 grid list-none gap-1.5 p-3">
                {byVehicle
                  .flatMap((g) => g.list)
                  .sort((a, b) => RANK[a.status.state] - RANK[b.status.state] || used(b) - used(a))
                  .map((i) => (
                    <ServiceRow key={i.id} i={i} vehicle={i.vehicleName} active={i.id === recordId} every={every(i)} due={dueText(i)} canWrite={props.canWrite} onOpen={() => setRecordId(i.id)} onDone={() => setServicing(i)} />
                  ))}
              </ul>
            )}
          </Card>

          {record && (
            <div className="fixed inset-x-2 bottom-2 top-16 z-40 overflow-y-auto overscroll-contain rounded-2xl animate-in sm:left-auto sm:right-4 sm:top-[72px] sm:w-[400px]">
              <ServiceRecord
                i={record}
                every={every(record)}
                due={dueText(record)}
                remaining={remaining(record)}
                canWrite={props.canWrite}
                onClose={() => setRecordId(null)}
                onDone={() => setServicing(record)}
                onDelete={() => setDeleting(record)}
              />
            </div>
          )}
        </>
      )}

      {props.canWrite && (
        <>
          <AddReminderDialog
            open={adding}
            onOpenChange={(o) => {
              setAdding(o);
              if (!o) setAddFor(null);
            }}
            vehicleId={addFor}
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

function AddReminderDialog({ open, onOpenChange, vehicleId, vehicles, members, myUserId, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; vehicleId?: string | null; vehicles: Opt[]; members: Opt[]; myUserId: string; onCreated: () => Promise<void> }) {
  const u = useUnits();
  const time = useTime();
  // Service dates are calendar days in the viewer's zone, stored as local noon (never slips a day).
  const today = time.dayKey(Date.now());
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
          lastServiceAt: wallTimeToUtc(`${String(f.get("lastServiceAt"))}T12:00`, time.timeZone).toISOString(),
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
              <Select id="m-vehicle" name="vehicleId" required defaultValue={vehicleId ?? undefined}>
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
              <Input id="m-last" name="lastServiceAt" type="date" required defaultValue={today} max={today} />
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
  const time = useTime();
  // Service dates are calendar days in the viewer's zone, stored as local noon (never slips a day).
  const today = time.dayKey(Date.now());
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
                    servicedAt: d === today ? undefined : wallTimeToUtc(`${d}T12:00`, time.timeZone).toISOString(),
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
                <Input id="s-date" type="date" name="servicedAt" required defaultValue={today} max={today} />
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

/** One service of a vehicle: what, how often, a progress bar to the due point, and a quick "done". */
function ServiceRow({ i, vehicle, active, every, due, canWrite, onOpen, onDone }: { i: ItemDto; vehicle?: string; active: boolean; every: string; due: string; canWrite: boolean; onOpen: () => void; onDone: () => void }) {
  const time = useTime();
  const c = COLOR[i.status.state];
  return (
    <li className={cn("grid grid-cols-[28px_minmax(0,1.4fr)_minmax(0,1fr)_auto] items-center gap-3 rounded-xl bg-background px-3 py-2", active ? "shadow-[inset_0_0_0_2px_var(--color-primary)]" : "shadow-[inset_0_0_0_1px_var(--color-border)]")}>
      <span className="grid size-7 place-items-center rounded-lg text-white" style={{ background: c }}>
        <Wrench className="size-3.5" aria-hidden="true" />
      </span>
      <button type="button" onClick={onOpen} className="grid min-w-0 cursor-pointer border-0 bg-transparent p-0 text-left leading-tight">
        <b className="truncate text-[13px] text-foreground">{vehicle ? `${vehicle} · ${i.name}` : i.name}</b>
        <span className="truncate text-xs text-muted-foreground">
          Every {every} · last done {time.date(i.lastServiceAt)}
        </span>
      </button>
      <span className="grid min-w-0 gap-1">
        <span className="h-1.5 overflow-hidden rounded-full bg-muted">
          <span className="block h-full rounded-full" style={{ width: `${used(i)}%`, background: c }} />
        </span>
        <span className="truncate text-xs font-bold" style={{ color: c }}>
          {due}
        </span>
      </span>
      <span className="flex items-center gap-1">
        {canWrite && (
          <Button size="icon-sm" variant={i.status.state === "ok" ? "secondary" : "primary"} aria-label={`Mark ${i.name} done`} title="Mark as done" onClick={onDone}>
            <Check />
          </Button>
        )}
        <Button size="icon-sm" variant="ghost" aria-label={`Open ${i.name}`} title="Details and history" onClick={onOpen}>
          <ChevronRight />
        </Button>
      </span>
    </li>
  );
}

/** The service's record: progress, schedule, actions and its full service history. */
function ServiceRecord({ i, every, due, remaining, canWrite, onClose, onDone, onDelete }: { i: ItemDto; every: string; due: string; remaining: string; canWrite: boolean; onClose: () => void; onDone: () => void; onDelete: () => void }) {
  const u = useUnits();
  const time = useTime();
  const c = COLOR[i.status.state];
  const label = { overdue: "Overdue", due_soon: "Due soon", ok: "Up to date" }[i.status.state];
  return (
    <aside aria-label={`${i.name} for ${i.vehicleName}`} className="overflow-hidden rounded-2xl border border-border bg-background shadow-pop">
      <div className="flex items-start gap-3 border-b border-border px-4 py-3" style={{ background: `linear-gradient(120deg, var(--color-background) 40%, color-mix(in srgb, ${c} 12%, var(--color-background)))` }}>
        <span className="grid size-10 shrink-0 place-items-center rounded-xl text-white" style={{ background: c }}>
          <Wrench className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-xs text-muted-foreground">{i.vehicleName}</p>
          <h2 className="m-0 truncate text-lg font-extrabold text-primary">{i.name}</h2>
          <span className="mt-1 inline-flex h-6 items-center rounded-full px-2.5 text-xs font-bold" style={{ color: c, background: `color-mix(in srgb, ${c} 12%, var(--color-background))` }}>
            {label} · {due}
          </span>
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className="grid size-8 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-muted-foreground hover:bg-muted">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="grid gap-3 p-4">
        <div className="grid gap-1">
          <span className="h-2 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full" style={{ width: `${used(i)}%`, background: c }} />
          </span>
          <span className="text-xs text-muted-foreground">{remaining || "—"}</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {(
            [
              ["Repeats", `Every ${every}`],
              ["Since last service", u.fmtDist(i.status.kmSinceService, 0)],
              ["Last done", time.date(i.lastServiceAt)],
              ["Odometer then", i.lastServiceOdometerKm !== null ? u.fmtDist(i.lastServiceOdometerKm, 0) : "—"],
              ["Due date", i.status.dueDate ? time.date(`${i.status.dueDate}T12:00:00Z`) : "By distance"],
              ["Reminders to", `${i.notifyUserIds.length} ${i.notifyUserIds.length === 1 ? "person" : "people"}`]
            ] as const
          ).map(([l, v]) => (
            <div key={l} className="min-w-0 rounded-lg bg-canvas px-2.5 py-1.5 shadow-[inset_0_0_0_1px_var(--color-border)]">
              <span className="block text-[11px] text-muted-foreground">{l}</span>
              <b className="block truncate text-[13px]">{v}</b>
            </div>
          ))}
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <Button className="flex-1" onClick={onDone}>
              <CalendarCheck /> Mark as done
            </Button>
            <Button variant="secondary" onClick={onDelete} aria-label="Delete this service" title="Delete this service" className="px-2.5 text-danger">
              <Trash2 />
            </Button>
          </div>
        )}
        <section aria-labelledby="svc-history">
          <h3 id="svc-history" className="m-0 mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            <History className="size-3.5" aria-hidden="true" /> Service history
          </h3>
          {i.history.length === 0 ? (
            <p className="m-0 rounded-lg bg-canvas px-3 py-2 text-xs text-muted-foreground">No services recorded yet. Use Mark as done after each service.</p>
          ) : (
            <ol className="m-0 grid list-none p-0">
              {i.history.map((h, n) => (
                <li key={h.servicedAt} className="grid grid-cols-[22px_minmax(0,1fr)] gap-2">
                  <span className="flex flex-col items-center">
                    <span className="mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-success text-white">
                      <Check className="size-3" aria-hidden="true" />
                    </span>
                    {n < i.history.length - 1 && <span className="w-0.5 flex-1 bg-border" />}
                  </span>
                  <div className="pb-2.5">
                    <p className="m-0 text-[13px] font-semibold">
                      {time.date(h.servicedAt)}
                      {h.odometerKm !== null && <span className="font-normal text-muted-foreground"> · {u.fmtDist(h.odometerKm, 0)}</span>}
                    </p>
                    {h.note && <p className="m-0 text-xs">{h.note}</p>}
                    {h.kmSincePrevious !== null && <p className="m-0 text-[11px] text-muted-foreground">{u.fmtDist(h.kmSincePrevious, 0)} since the previous service</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
        {i.note && (
          <div className="rounded-lg bg-canvas px-3 py-2 text-xs shadow-[inset_0_0_0_1px_var(--color-border)]">
            <b>Notes</b>
            <p className="m-0 mt-0.5 text-foreground/80">{i.note}</p>
          </div>
        )}
      </div>
    </aside>
  );
}
