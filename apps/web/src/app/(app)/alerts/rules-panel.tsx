"use client";
import { Mail, MailX, MoreHorizontal, Plus, Siren, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { useUnits } from "@/components/app/units-context";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import type { AlertRuleDto } from "@/lib/alerts";
import { api, errorMessage } from "@/lib/client/api";
import { TYPE_LABEL } from "./alert-meta";

type Ref = { id: string; name: string };

export function RulesPanel({ rules, geofences, vehicles, canWrite, onChanged }: { rules: AlertRuleDto[]; geofences: Ref[]; vehicles: Ref[]; canWrite: boolean; onChanged: () => void }) {
  const u = useUnits();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<AlertRuleDto | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const summary = (r: AlertRuleDto) => {
    const target = r.vehicleId ? (vehicles.find((v) => v.id === r.vehicleId)?.name ?? "a vehicle") : "All vehicles";
    const extra =
      r.type === "speeding" ? ` above ${u.fmtSpeed(r.speedKph)}` : r.type === "device_offline" ? ` for ${r.offlineMinutes} min` : r.geofenceId ? `: ${geofences.find((g) => g.id === r.geofenceId)?.name ?? "zone"}` : "";
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

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="m-0 text-sm text-muted-foreground">Rules decide when an alert is created. Email goes to Org Admins, Fleet Managers and Dispatchers.</p>
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
            <div key={r.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.name}</span>
                  {!r.active && <StatusBadge tone="neutral" label="Paused" />}
                  {r.notifyEmail && <StatusBadge tone="info" label="Email" />}
                </div>
                <div className="mt-0.5 text-sm text-muted-foreground">{summary(r)}</div>
              </div>
              {canWrite && (
                <div className="flex items-center gap-2">
                  <Switch checked={r.active} disabled={busyId === r.id} onCheckedChange={(v) => patch(r, { active: v }, v ? "Rule resumed." : "Rule paused.")} label={`${r.name} active`} />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${r.name}`}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onSelect={() => patch(r, { notifyEmail: !r.notifyEmail }, r.notifyEmail ? "Email notifications off." : "Email notifications on.")}>
                        {r.notifyEmail ? <MailX /> : <Mail />} {r.notifyEmail ? "Turn email off" : "Turn email on"}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem destructive onSelect={() => setDeleting(r)}>
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

function NewRuleDialog({ open, onOpenChange, geofences, vehicles, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; geofences: Ref[]; vehicles: Ref[]; onCreated: () => void }) {
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
          speedKph: type === "speeding" && limit !== null ? Math.round(u.toKph(limit)) : null,
          offlineMinutes: type === "device_offline" ? num("offlineMinutes") : null,
          notifyEmail: f.get("notifyEmail") === "on"
        }
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
      <DialogContent title="New alert rule" description="Alerts fire when the condition starts, not repeatedly while it continues.">
        <form method="post" onSubmit={submit} className="grid gap-4">
          <Field id="ar-name" label="Name" required>
            <Input id="ar-name" name="name" required maxLength={120} placeholder="e.g. Highway speed limit" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="ar-type" label="When">
              <Select id="ar-type" value={type} onChange={(e) => setType(e.target.value)}>
                {Object.entries(TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
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
              <Field id="ar-zone" label="Zone" required description={geofences.length ? undefined : "Create a zone on the Zones page first."}>
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
                <Input id="ar-speed" name="speed" type="number" required min={u.system === "imperial" ? 3 : 5} max={u.system === "imperial" ? 186 : 300} placeholder={u.system === "imperial" ? "65" : "100"} />
              </Field>
            )}
            {type === "device_offline" && (
              <Field id="ar-off" label="Offline for (minutes)" required description="A parked FTM880 reports about hourly; 90+ avoids false alarms.">
                <Input id="ar-off" name="offlineMinutes" type="number" required min={5} max={10080} defaultValue={90} />
              </Field>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="notifyEmail" /> Also send an email
          </label>
          {error && <Alert tone="danger">{error}</Alert>}
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
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
