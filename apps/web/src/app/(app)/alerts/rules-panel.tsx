"use client";
import {
  Gauge,
  LogIn,
  LogOut,
  Mail,
  MailX,
  MoreHorizontal,
  Plus,
  Power,
  Siren,
  SlidersHorizontal,
  Trash2,
  WifiOff,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { useUnits } from "@/components/app/units-context";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import type { AlertRuleDto } from "@/lib/alerts";
import { api, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import { TYPE_LABEL } from "./alert-meta";
import { Hexagon, LogOut as ExitIcon, PowerOff } from "lucide-react";

/** Alert types as tiles (A23), each in its colour. */
const RULE_TILES = [
  { k: "speeding", Icon: Gauge, color: "#d81e2c" },
  { k: "geofence_enter", Icon: Hexagon, color: "#6d28d9" },
  { k: "geofence_exit", Icon: ExitIcon, color: "#7c3aed" },
  { k: "ignition_on", Icon: Power, color: "#15803d" },
  { k: "ignition_off", Icon: PowerOff, color: "#c2410c" },
  { k: "device_offline", Icon: WifiOff, color: "#526079" }
] as const;

type Ref = { id: string; name: string };

const RULE_LOOK: Record<string, { icon: typeof Gauge; color: string }> = {
  speeding: { icon: Gauge, color: "#c42121" },
  geofence_enter: { icon: LogIn, color: "#7c3aed" },
  geofence_exit: { icon: LogOut, color: "#7c3aed" },
  device_offline: { icon: WifiOff, color: "#64748b" },
  ignition_on: { icon: Power, color: "#0f766e" },
  ignition_off: { icon: Power, color: "#0f766e" },
};

/**
 * Alert rules. `compact` is the side panel on the Alerts page (icon, name, one-line summary, on/off);
 * the creating state can be controlled so the page header's "New alert rule" opens the same dialog.
 */
export function RulesPanel({
  rules,
  geofences,
  vehicles,
  canWrite,
  onChanged,
  compact = false,
  creating: creatingProp,
  onCreatingChange,
}: {
  rules: AlertRuleDto[];
  geofences: Ref[];
  vehicles: Ref[];
  canWrite: boolean;
  onChanged: () => void;
  compact?: boolean;
  creating?: boolean;
  onCreatingChange?: (open: boolean) => void;
}) {
  const u = useUnits();
  const [creatingState, setCreatingState] = useState(false);
  const creating = creatingProp ?? creatingState;
  const setCreating = (v: boolean) =>
    onCreatingChange ? onCreatingChange(v) : setCreatingState(v);
  const [deleting, setDeleting] = useState<AlertRuleDto | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const summary = (r: AlertRuleDto) => {
    const target = r.vehicleId
      ? (vehicles.find((v) => v.id === r.vehicleId)?.name ?? "a vehicle")
      : "All vehicles";
    const extra =
      r.type === "speeding"
        ? ` above ${u.fmtSpeed(r.speedKph)}`
        : r.type === "device_offline"
          ? ` for ${r.offlineMinutes} min`
          : r.geofenceId
            ? `: ${geofences.find((g) => g.id === r.geofenceId)?.name ?? "zone"}`
            : "";
    return `${TYPE_LABEL[r.type]}${extra} · ${target}`;
  };

  async function patch(r: AlertRuleDto, body: object, msg: string) {
    setBusyId(r.id);
    try {
      await api(`/api/alert-rules/${r.id}`, { method: "PATCH", json: body });
      toast.success(msg);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  const menu = (r: AlertRuleDto) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`More actions for ${r.name}`}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem
          onSelect={() =>
            patch(
              r,
              { notifyEmail: !r.notifyEmail },
              r.notifyEmail
                ? "Email notifications off."
                : "Email notifications on.",
            )
          }
        >
          {r.notifyEmail ? <MailX /> : <Mail />}{" "}
          {r.notifyEmail ? "Turn email off" : "Turn email on"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => setDeleting(r)}>
          <Trash2 /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const list = compact ? (
    <Card className="overflow-hidden xl:sticky xl:top-4">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="m-0 flex items-center gap-2 text-base font-semibold text-[#0a2463] dark:text-foreground">
          <span className="grid size-8 place-items-center rounded-lg bg-primary-soft text-primary">
            <SlidersHorizontal className="size-4" aria-hidden="true" />
          </span>
          Alert rules
          <span className="text-sm font-normal text-muted-foreground">
            {rules.length}
          </span>
        </h2>
        {canWrite && (
          <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
            <Plus /> Add
          </Button>
        )}
      </div>
      {rules.length === 0 ? (
        <EmptyState
          icon={Siren}
          title="No alert rules yet"
          description="For example: speeding above 65 mph, leaving the yard, or a tracker offline for 90 minutes."
        />
      ) : (
        <ul className="m-0 grid list-none gap-2 p-3">
          {rules.map((r) => {
            const look = RULE_LOOK[r.type] ?? RULE_LOOK.ignition_on!;
            const Icon = look.icon;
            return (
              <li
                key={r.id}
                className={cn(
                  "relative flex items-center gap-2.5 overflow-hidden rounded-xl border py-2 pl-3.5 pr-2",
                  !r.active && "opacity-70",
                )}
                style={{
                  borderColor: `color-mix(in srgb, ${look.color} 22%, var(--color-border))`,
                  backgroundImage: `linear-gradient(110deg, var(--color-background) 45%, color-mix(in srgb, ${look.color} 9%, var(--color-background)) 100%)`,
                }}
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 w-1"
                  style={{ background: look.color }}
                />
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-lg text-white"
                  style={{
                    background: `linear-gradient(150deg, color-mix(in srgb, ${look.color} 75%, #fff), ${look.color})`,
                  }}
                >
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="m-0 flex items-center gap-1.5 text-sm font-semibold">
                    <span className="truncate">{r.name}</span>
                    {r.notifyEmail && (
                      <Mail
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-label="Email on"
                      />
                    )}
                  </p>
                  <p
                    className="m-0 truncate text-xs text-muted-foreground"
                    title={summary(r)}
                  >
                    {r.active ? summary(r) : `Paused · ${summary(r)}`}
                  </p>
                </div>
                {canWrite && (
                  <>
                    <Switch
                      checked={r.active}
                      disabled={busyId === r.id}
                      onCheckedChange={(v) =>
                        patch(
                          r,
                          { active: v },
                          v ? "Rule resumed." : "Rule paused.",
                        )
                      }
                      label={`${r.name} active`}
                    />
                    {menu(r)}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="m-0 border-t border-border px-4 py-3 text-xs text-muted-foreground">
        Alerts show in the app and the bell. Email goes to Org Admins, Fleet
        Managers and Dispatchers for rules with email on.
      </p>
    </Card>
  ) : null;

  return (
    <>
      {compact ? (
        list
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="m-0 text-sm text-muted-foreground">
              Rules decide when an alert is created. Email goes to Org Admins,
              Fleet Managers and Dispatchers.
            </p>
            {canWrite && (
              <Button onClick={() => setCreating(true)}>
                <Plus /> New rule
              </Button>
            )}
          </div>
          {rules.length === 0 ? (
            <Card>
              <EmptyState
                icon={Siren}
                title="No alert rules yet"
                description="For example: speeding above 65 mph, leaving the depot zone, or a tracker offline for 90 minutes."
                action={
                  canWrite && (
                    <Button size="sm" onClick={() => setCreating(true)}>
                      <Plus /> New rule
                    </Button>
                  )
                }
              />
            </Card>
          ) : (
            <Card className="divide-y divide-border">
              {rules.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.name}</span>
                      {!r.active && (
                        <StatusBadge tone="neutral" label="Paused" />
                      )}
                      {r.notifyEmail && (
                        <StatusBadge tone="info" label="Email" />
                      )}
                    </div>
                    <div className="mt-0.5 text-sm text-muted-foreground">
                      {summary(r)}
                    </div>
                  </div>
                  {canWrite && (
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={r.active}
                        disabled={busyId === r.id}
                        onCheckedChange={(v) =>
                          patch(
                            r,
                            { active: v },
                            v ? "Rule resumed." : "Rule paused.",
                          )
                        }
                        label={`${r.name} active`}
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`More actions for ${r.name}`}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem
                            onSelect={() =>
                              patch(
                                r,
                                { notifyEmail: !r.notifyEmail },
                                r.notifyEmail
                                  ? "Email notifications off."
                                  : "Email notifications on.",
                              )
                            }
                          >
                            {r.notifyEmail ? <MailX /> : <Mail />}{" "}
                            {r.notifyEmail ? "Turn email off" : "Turn email on"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            destructive
                            onSelect={() => setDeleting(r)}
                          >
                            <Trash2 /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </div>
              ))}
            </Card>
          )}
        </>
      )}
      {canWrite && (
        <NewRuleDialog
          open={creating}
          onOpenChange={setCreating}
          geofences={geofences}
          vehicles={vehicles}
          onCreated={() => {
            toast.success("Rule created.");
            onChanged();
          }}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete rule "${deleting?.name ?? ""}"?`}
        description="No new alerts will be created by this rule. Past alerts stay in the history."
        confirmLabel="Delete rule"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          await api(`/api/alert-rules/${deleting.id}`, { method: "DELETE" });
          setDeleting(null);
          toast.success("Rule deleted.");
          onChanged();
        }}
      />
    </>
  );
}

function NewRuleDialog({
  open,
  onOpenChange,
  geofences,
  vehicles,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  geofences: Ref[];
  vehicles: Ref[];
  onCreated: () => void;
}) {
  const u = useUnits();
  const [type, setType] = useState("speeding");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const zone = type === "geofence_enter" || type === "geofence_exit";

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) => (f.get(k) ? Number(f.get(k)) : null);
    const limit = num("speed");
    setBusy(true);
    setError(null);
    try {
      await api("/api/alert-rules", {
        method: "POST",
        json: {
          name: f.get("name"),
          type,
          vehicleId: f.get("vehicleId") || null,
          geofenceId: zone ? f.get("geofenceId") || null : null,
          // Stored in km/h; entered in the organization's unit.
          speedKph:
            type === "speeding" && limit !== null
              ? Math.round(u.toKph(limit))
              : null,
          offlineMinutes:
            type === "device_offline" ? num("offlineMinutes") : null,
          notifyEmail: f.get("notifyEmail") === "on",
        },
      });
      onOpenChange(false);
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        title="New alert rule"
        description="Alerts fire when the condition starts, not repeatedly while it continues."
      >
        <form method="post" onSubmit={submit} className="grid gap-4">
          <fieldset className="m-0 grid gap-1.5 border-0 p-0">
            <legend className="mb-1.5 p-0 text-sm font-medium">Alert type</legend>
            <div role="radiogroup" aria-label="Alert type" className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {RULE_TILES.map(({ k, Icon, color }) => {
                const on = type === k;
                return (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setType(k)}
                    className="grid cursor-pointer justify-items-center gap-1.5 rounded-xl border-2 bg-background px-1 py-2.5 text-[11.5px] font-semibold text-foreground"
                    style={{ borderColor: on ? color : "var(--color-border)", background: on ? `color-mix(in srgb, ${color} 9%, var(--color-background))` : undefined }}
                  >
                    <span className="grid size-8 place-items-center rounded-lg text-white" style={{ background: color }}>
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <span className="text-center leading-tight">{TYPE_LABEL[k]}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <Field id="ar-name" label="Name" required>
            <Input
              id="ar-name"
              name="name"
              required
              maxLength={120}
              placeholder="e.g. Highway speed limit"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="ar-vehicle" label="Vehicle">
              <Select id="ar-vehicle" name="vehicleId" defaultValue="">
                <option value="">All vehicles</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </Field>
            {zone && (
              <Field
                id="ar-zone"
                label="Zone"
                required
                description={
                  geofences.length
                    ? undefined
                    : "Create a zone on the Zones page first."
                }
              >
                <Select id="ar-zone" name="geofenceId" required defaultValue="">
                  <option value="" disabled>
                    Choose a zone
                  </option>
                  {geofences.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {type === "speeding" && (
              <Field id="ar-speed" label={`Speed limit (${u.speed})`} required>
                <Input
                  id="ar-speed"
                  name="speed"
                  type="number"
                  required
                  min={u.system === "imperial" ? 3 : 5}
                  max={u.system === "imperial" ? 186 : 300}
                  defaultValue={u.system === "imperial" ? 65 : 100}
                />
              </Field>
            )}
            {type === "device_offline" && (
              <Field
                id="ar-off"
                label="Offline for (minutes)"
                required
                description="A parked tracker reports about hourly; 90+ avoids false alarms."
              >
                <Input
                  id="ar-off"
                  name="offlineMinutes"
                  type="number"
                  required
                  min={5}
                  max={10080}
                  defaultValue={90}
                />
              </Field>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="notifyEmail" /> Also send an email
          </label>
          {error && <Alert tone="danger">{error}</Alert>}
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Create rule
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
