"use client";
import { CalendarClock, Mail, MoreHorizontal, Pause, Play, Plus, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import type { ScheduleDto } from "@/lib/report-schedules";

type Opt = { id: string; label: string };
const DAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const hour = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export function SchedulesManager(props: { initial: ScheduleDto[]; members: Opt[]; devices: Opt[]; myUserId: string; emailEnabled: boolean }) {
  const [items, setItems] = useState(props.initial);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ScheduleDto | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const name = (list: Opt[], id: string) => list.find((o) => o.id === id)?.label.replace(/ <.*>$/, "") ?? "(removed member)";

  async function refresh() {
    setItems((await api<{ schedules: ScheduleDto[] }>("/api/report-schedules")).schedules);
  }
  async function act(id: string, fn: () => Promise<string>) {
    setBusyId(id);
    try {
      toast.success(await fn());
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Report emails"
        description="Trip summaries emailed automatically for the previous day or week: trips, distance, driving time and top speed per vehicle."
        breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: "Email schedules" }]}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New schedule
          </Button>
        }
      />
      {!props.emailEnabled && (
        <div className="mb-4">
          <Alert tone="warning" title="Email is not configured on this server">
            Schedules are saved but won&apos;t send until email is set up.
          </Alert>
        </div>
      )}

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarClock}
            title="No report emails yet"
            description="Get a daily or weekly summary of your fleet in your inbox."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus /> New schedule
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3">
          {items.map((s) => (
            <Card key={s.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="m-0 text-[15px] font-semibold">{s.name}</h2>
                  <StatusBadge tone={s.active ? "success" : "neutral"} label={s.active ? "Active" : "Paused"} />
                </div>
                <p className="m-0 mt-1 text-sm text-foreground">
                  {s.frequency === "daily" ? `Every day at ${hour(s.sendHour)}` : `Every ${DAYS[s.weekday]} at ${hour(s.sendHour)}`} <span className="text-muted-foreground">({s.timeZone})</span>
                </p>
                <p className="m-0 mt-0.5 text-sm text-muted-foreground">
                  {s.deviceIds ? s.deviceIds.map((id) => name(props.devices, id)).join(", ") : "All vehicles"} · to {s.recipientUserIds.map((id) => name(props.members, id)).join(", ")}
                  {s.attachCsv ? " · CSV attached" : ""}
                </p>
                <p className="m-0 mt-1 text-xs text-muted-foreground">
                  {s.lastSentAt ? `Last sent ${new Date(s.lastSentAt).toLocaleString()}${s.lastStatus ? ` (${s.lastStatus})` : ""}` : s.lastStatus ? `Last status: ${s.lastStatus}` : "Not sent yet"}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busyId === s.id}
                  disabled={!props.emailEnabled}
                  onClick={() => act(s.id, async () => `Test for ${(await api<{ period: string }>(`/api/report-schedules/${s.id}/test`, { method: "POST" })).period} sent to your email.`)}
                >
                  <Send /> Send me a test
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon-sm" variant="ghost" aria-label={`More actions for ${s.name}`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => act(s.id, async () => (await api(`/api/report-schedules/${s.id}`, { method: "PATCH", json: { active: !s.active } }), s.active ? "Schedule paused." : "Schedule resumed."))}>
                      {s.active ? <Pause /> : <Play />} {s.active ? "Pause" : "Resume"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive onSelect={() => setDeleting(s)}>
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Reports use the same trip calculation as <Link href="/reports">Trip reports</Link>. A new schedule starts with the next period.
      </p>

      <NewScheduleDialog
        open={creating}
        onOpenChange={setCreating}
        members={props.members}
        devices={props.devices}
        myUserId={props.myUserId}
        onCreated={async () => {
          await refresh();
          toast.success("Schedule saved. The first email goes out at the next scheduled time.");
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.name ?? ""}"?`}
        description="No more emails will be sent for this schedule."
        confirmLabel="Delete schedule"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          await api(`/api/report-schedules/${deleting.id}`, { method: "DELETE" });
          setDeleting(null);
          await refresh();
          toast.success("Schedule deleted.");
        }}
      />
    </>
  );
}

function NewScheduleDialog({
  open,
  onOpenChange,
  members,
  devices,
  myUserId,
  onCreated
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  members: Opt[];
  devices: Opt[];
  myUserId: string;
  onCreated: () => Promise<void>;
}) {
  const [freq, setFreq] = useState<"daily" | "weekly">("daily");
  const [allDevices, setAllDevices] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const browserTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const recipients = f.getAll("recipient").map(String);
    const chosen = f.getAll("device").map(String);
    if (recipients.length === 0) return setError("Choose at least one recipient.");
    if (!allDevices && chosen.length === 0) return setError("Choose at least one vehicle, or All vehicles.");
    setBusy(true);
    setError(null);
    try {
      await api("/api/report-schedules", {
        method: "POST",
        json: {
          name: f.get("name"),
          frequency: freq,
          timeZone: f.get("timeZone"),
          sendHour: Number(f.get("sendHour")),
          weekday: Number(f.get("weekday") ?? 1),
          deviceIds: allDevices ? null : chosen,
          recipientUserIds: recipients,
          attachCsv: f.get("attachCsv") === "on"
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
      <DialogContent title="New report email" description="Sent automatically; the first one covers the next full period.">
        <form method="post" onSubmit={submit} className="grid gap-4" id="new-schedule">
          <Field id="rs-name" label="Name" required>
            <Input id="rs-name" name="name" required maxLength={120} defaultValue={freq === "daily" ? "Daily fleet summary" : "Weekly fleet summary"} key={freq} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="rs-freq" label="How often">
              <Select id="rs-freq" value={freq} onChange={(e) => setFreq(e.target.value as "daily" | "weekly")}>
                <option value="daily">Daily (previous day)</option>
                <option value="weekly">Weekly (previous Mon–Sun)</option>
              </Select>
            </Field>
            {freq === "weekly" && (
              <Field id="rs-day" label="Send on">
                <Select id="rs-day" name="weekday" defaultValue="1">
                  {DAYS.slice(1).map((d, i) => (
                    <option key={d} value={i + 1}>
                      {d}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field id="rs-hour" label="Send at">
              <Select id="rs-hour" name="sendHour" defaultValue="7">
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {hour(h)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="rs-tz" label="Time zone" description="IANA name, e.g. America/Chicago">
              <Input id="rs-tz" name="timeZone" required defaultValue={browserTz} maxLength={64} />
            </Field>
          </div>

          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="mb-1 text-sm font-medium">Vehicles</legend>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={allDevices} onChange={(e) => setAllDevices(e.target.checked)} /> All vehicles (including ones added later)
            </label>
            {!allDevices && (
              <div className="grid max-h-40 gap-1.5 overflow-auto rounded-md border border-border p-2">
                {devices.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 text-sm">
                    <Checkbox name="device" value={d.id} /> {d.label}
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <fieldset className="m-0 grid gap-1.5 border-0 p-0">
            <legend className="mb-1 text-sm font-medium">Recipients</legend>
            <div className="grid max-h-40 gap-1.5 overflow-auto rounded-md border border-border p-2">
              {members.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm">
                  <Checkbox name="recipient" value={m.id} defaultChecked={m.id === myUserId} /> {m.label}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="attachCsv" defaultChecked /> <Mail className="size-4 text-muted-foreground" aria-hidden="true" /> Attach a CSV of every trip
          </label>

          {error && <Alert tone="danger">{error}</Alert>}

          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Save schedule
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
