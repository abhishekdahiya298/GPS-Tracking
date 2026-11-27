"use client";
import { RouteCell } from "../loads/loads-view";
import { LOAD_STATUS_META } from "@/lib/load-meta";
import { AlertTriangle, Bell, FileText, History, LogOut, MapPin, Package, Pencil, Send, X } from "lucide-react";
import { RelativeTime } from "@/components/app/local-time";
import { APP_STATE, AppStateChip, Battery } from "./driver-app-bits";
import { AskLocationDialog, canAskAgainAt } from "./ask-location-dialog";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTime } from "@/components/app/time-context";
import { useUnits } from "@/components/app/units-context";
import { PlateTag } from "@/components/app/vehicle-tags";
import { VehiclePicture } from "@/components/app/vehicle-picture";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import type { DriverRecord, DriverRow } from "@/lib/drivers";
import { DriverAvatar } from "./drivers-view";

function hm(seconds: number) {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}
const days = (a: string, b: string | null) => Math.max(1, Math.round(((b ? Date.parse(b) : Date.now()) - Date.parse(a)) / 86_400_000));

/** A driver's record beside the list: active switch, licence, last 7 days and every vehicle they drove. */
export function DriverRecordPanel({ driver, canUpdate, onEdit, onInvite, onClose, onChanged }: { driver: DriverRow; canUpdate: boolean; onEdit: () => void; onInvite?: () => void; onClose: () => void; onChanged: () => void }) {
  const u = useUnits();
  const time = useTime();
  const [rec, setRec] = useState<DriverRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let live = true;
    setRec(null);
    setError(null);
    api<DriverRecord>(`/api/drivers/${driver.id}/record`)
      .then((r) => live && setRec(r))
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [driver.id, driver.vehicle?.id, driver.status]);

  const active = driver.status === "active";
  async function toggleActive() {
    setSaving(true);
    try {
      await api(`/api/drivers/${driver.id}`, { method: "PATCH", json: { status: active ? "inactive" : "active" } });
      toast.success(active ? `${driver.name} is now inactive. Their history is kept.` : `${driver.name} is active again.`);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const facts: [string, string][] = [
    ["Licence", driver.licenseNumber ?? "—"],
    ["Licence valid to", driver.licenseExpiresOn ? time.date(`${driver.licenseExpiresOn}T12:00:00Z`) : "—"],
    ["Phone", driver.phone ?? "—"],
    ["Email", driver.email ?? "—"]
  ];

  return (
    <aside aria-label={`${driver.name}: driver record`} className="min-w-0 overflow-hidden rounded-2xl border border-border bg-background shadow-pop xl:sticky xl:top-4">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3" style={{ background: "linear-gradient(120deg, var(--color-background) 40%, color-mix(in srgb, #0f766e 12%, var(--color-background)))" }}>
        <DriverAvatar name={driver.name} className="size-11 text-base" />
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate text-lg font-extrabold text-primary">{driver.name}</h2>
          <p className="m-0 truncate text-xs text-muted-foreground">{[driver.phone, driver.email].filter(Boolean).join(" · ") || "No contact details"}</p>
        </div>
        <button type="button" aria-label="Close driver record" onClick={onClose} className="grid size-8 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-muted-foreground hover:bg-muted">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="grid gap-3.5 p-4">
        <label className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5", active ? "bg-success-soft" : "bg-muted")}>
          <button
            type="button"
            role="switch"
            aria-checked={active}
            disabled={!canUpdate || saving}
            onClick={toggleActive}
            className={cn("relative h-6 w-11 shrink-0 cursor-pointer rounded-full border-0 transition-colors disabled:cursor-not-allowed disabled:opacity-60", active ? "bg-success" : "bg-muted-foreground/40")}
          >
            <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", active ? "left-[22px]" : "left-0.5")} />
          </button>
          <span className="min-w-0">
            <b className="block text-[13px]">{active ? "Active driver" : "Inactive driver"}</b>
            <span className="block text-xs text-muted-foreground">{active ? "Turn off when someone leaves. Their trips and history are kept." : "Can't be assigned to a vehicle until turned on again."}</span>
          </span>
        </label>

        {active && <DriverAppCard driver={driver} canUpdate={canUpdate} onInvite={onInvite} onChanged={onChanged} />}

        <div className="grid grid-cols-2 gap-1.5">
          {facts.map(([l, v]) => (
            <div key={l} className="min-w-0 rounded-lg bg-canvas px-2.5 py-1.5 shadow-[inset_0_0_0_1px_var(--color-border)]">
              <span className="block text-[11px] text-muted-foreground">{l}</span>
              <b className="block truncate text-[13px]" title={v}>
                {v}
              </b>
            </div>
          ))}
        </div>

        <section aria-labelledby="dr-week">
          <h3 id="dr-week" className="m-0 mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Last 7 days
          </h3>
          {rec ? (
            <div className="grid grid-cols-4 gap-1.5">
              {(
                [
                  ["Distance", u.fmtDist(rec.week.distanceM / 1000, 0), "#1d4ed8"],
                  ["Driving", hm(rec.week.drivingS), "#15803d"],
                  ["Trips", String(rec.week.trips), "#6d28d9"],
                  ["Speeding", String(rec.week.speeding), "#dc2626"]
                ] as const
              ).map(([l, v, c]) => (
                <div key={l} className="min-w-0 rounded-lg px-2 py-1.5" style={{ background: `linear-gradient(120deg, var(--color-background) 40%, color-mix(in srgb, ${c} 12%, var(--color-background)))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${c} 22%, transparent)` }}>
                  <b className="block truncate text-sm tabular-nums">{v}</b>
                  <span className="block text-[10.5px] text-muted-foreground">{l}</span>
                </div>
              ))}
            </div>
          ) : error ? (
            <p className="m-0 text-xs text-danger">{error}</p>
          ) : (
            <Skeleton className="h-12" />
          )}
        </section>

        <section aria-labelledby="dr-history">
          <div className="mb-1.5 flex items-center justify-between">
            <h3 id="dr-history" className="m-0 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Vehicle history
            </h3>
            {canUpdate && active && (
              <button type="button" onClick={onEdit} className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-primary hover:underline">
                Change vehicle
              </button>
            )}
          </div>
          {!rec ? (
            <Skeleton className="h-24" />
          ) : rec.history.length === 0 ? (
            <p className="m-0 rounded-lg bg-canvas px-3 py-2 text-xs text-muted-foreground">No vehicle assigned yet.</p>
          ) : (
            <ol className="m-0 grid list-none p-0">
              {rec.history.map((h, i) => {
                const current = !h.unassignedAt;
                return (
                  <li key={h.id} className="grid grid-cols-[18px_minmax(0,1fr)] gap-2">
                    <span className="flex flex-col items-center">
                      <span className={cn("mt-3 size-3 shrink-0 rounded-full", current ? "bg-success shadow-[0_0_0_4px_var(--color-success-soft)]" : "bg-muted-foreground/40")} />
                      {i < rec.history.length - 1 && <span className="w-0.5 flex-1 bg-border" />}
                    </span>
                    <Link href={`/vehicles/${h.vehicle.id}`} className={cn("mb-1.5 flex min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-foreground no-underline hover:brightness-[0.98]", current ? "bg-success-soft shadow-[inset_0_0_0_1px_rgb(22_163_74/0.3)]" : "bg-canvas shadow-[inset_0_0_0_1px_var(--color-border)]")}>
                      <VehiclePicture type={h.vehicle.type} state={current ? "moving" : "stopped"} className="h-8 w-11 rounded-md bg-background" />
                      <span className="grid min-w-0 leading-tight">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <b className="truncate text-[13px]">{h.vehicle.name}</b>
                          <PlateTag plate={h.vehicle.licensePlate} />
                          {current && <span className="rounded-full bg-background px-1.5 text-[10px] font-bold text-success">Current</span>}
                        </span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {time.date(h.assignedAt)} → {h.unassignedAt ? time.date(h.unassignedAt) : "now"}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {days(h.assignedAt, h.unassignedAt)} days{h.distanceM > 0 ? ` · about ${u.fmtDist(h.distanceM / 1000, 0)}` : ""}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {rec && rec.loads.length > 0 && (
          <section className="grid gap-2">
            <h3 className="m-0 flex items-center gap-1.5 text-[13px] font-bold">
              <Package className="size-4 text-primary" aria-hidden="true" /> Loads
              <span className="ml-auto text-[11px] font-semibold text-muted-foreground">{rec.loads.length} latest</span>
            </h3>
            <ul className="m-0 grid list-none gap-1.5 p-0">
              {rec.loads.map((l) => (
                <li key={l.id}>
                  <Link href={`/loads/${l.id}`} className="grid gap-1 rounded-xl bg-canvas px-2.5 py-2 text-foreground no-underline shadow-[inset_0_0_0_1px_var(--color-border)] transition-shadow hover:shadow-[inset_0_0_0_1.5px_var(--color-primary)]">
                    <span className="flex items-center gap-1.5 text-xs">
                      <b className="text-primary">{l.reference}</b>
                      <span className="rounded-full bg-muted px-1.5 text-[10.5px] font-bold text-muted-foreground">{LOAD_STATUS_META[l.status]?.label ?? l.status}</span>
                      <span className="ml-auto text-[11px] text-muted-foreground">{time.date(l.createdAt)}</span>
                    </span>
                    <RouteCell load={l} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {rec && rec.documents.length > 0 && (
          <section className="grid gap-2">
            <h3 className="m-0 flex items-center gap-1.5 text-[13px] font-bold">
              <FileText className="size-4 text-primary" aria-hidden="true" /> Latest documents
            </h3>
            <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0">
              {rec.documents.slice(0, 9).map((d) => (
                <li key={d.id} className="grid min-w-0 gap-0.5">
                  <a href={`/api/loads/${d.loadId}/documents/${d.id}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-border bg-background">
                    {d.contentType.startsWith("image/") && d.contentType !== "image/heic" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/loads/${d.loadId}/documents/${d.id}`} alt="" loading="lazy" className="h-16 w-full object-cover" />
                    ) : (
                      <span className="grid h-16 place-items-center text-[11px] font-semibold text-muted-foreground">PDF</span>
                    )}
                  </a>
                  <span className="truncate text-[10.5px] text-muted-foreground">
                    {d.reference} · {time.date(d.at)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="flex gap-2">
          {driver.vehicle?.deviceId ? (
            <Button asChild className="flex-1">
              <Link href={`/map?focus=${driver.vehicle.deviceId}`}>
                <History /> On the map
              </Link>
            </Button>
          ) : (
            <span className="flex-1" />
          )}
          <Button asChild variant="secondary">
            <Link href="/alerts">
              <Bell /> Alerts
            </Link>
          </Button>
          {canUpdate && (
            <Button variant="secondary" onClick={onEdit} aria-label="Edit driver" title="Edit driver" className="px-2.5">
              <Pencil />
            </Button>
          )}
        </div>
        {rec && rec.week.speeding > 0 && (
          <p className="m-0 flex items-center gap-1.5 text-xs text-danger">
            <AlertTriangle className="size-3.5" aria-hidden="true" /> {rec.week.speeding} speeding alert{rec.week.speeding === 1 ? "" : "s"} this week.
          </p>
        )}
      </div>
    </aside>
  );
}

/** The RIO GPS app on the driver's phone: whether it is sharing, battery, and sign out (A10). */
function DriverAppCard({ driver, canUpdate, onInvite, onChanged }: { driver: DriverRow; canUpdate: boolean; onInvite?: () => void; onChanged: () => void }) {
  const a = driver.app;
  const s = APP_STATE[a.state];
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const nextAsk = canAskAgainAt(a.locationAskedAt);
  const inApp = a.state !== "no_app" && a.state !== "signed_out";
  async function signOut() {
    setBusy(true);
    try {
      await api(`/api/drivers/${driver.id}/app-signout`, { method: "POST" });
      toast.success(`${driver.name} is signed out of the app.`);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const mapId = driver.vehicle?.deviceId ?? a.phoneDeviceId;
  return (
    <section aria-label="Driver app" className="grid gap-2.5 rounded-xl p-3" style={{ background: `linear-gradient(120deg, var(--color-background) 30%, color-mix(in srgb, ${s.color} 10%, var(--color-background)))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${s.color} 28%, transparent)` }}>
      <div className="flex items-start gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg text-white" style={{ background: s.color }}>
          <s.Icon className="size-[18px]" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <b className="block text-[13px]">Driver app</b>
          <span className="block text-xs text-muted-foreground">
            {inApp ? (
              <>
                {a.lastReportAt ? (
                  <>
                    Last update <RelativeTime iso={a.lastReportAt} />
                  </>
                ) : (
                  "Signed in"
                )}
              </>
            ) : a.inviteSentAt ? (
              <>
                Invite sent <RelativeTime iso={a.inviteSentAt} />
              </>
            ) : (
              s.hint
            )}
          </span>
        </span>
        <AppStateChip state={a.state} />
      </div>
      {inApp && (
        <div className="grid grid-cols-2 gap-1.5">
          <div className="min-w-0 rounded-lg bg-background/80 px-2.5 py-1.5 shadow-[inset_0_0_0_1px_var(--color-border)]">
            <span className="block text-[11px] text-muted-foreground">Location from</span>
            <b className="block truncate text-[13px]">{driver.vehicle?.deviceId ? `${driver.vehicle.name} tracker` : "Driver's phone"}</b>
          </div>
          <div className="min-w-0 rounded-lg bg-background/80 px-2.5 py-1.5 shadow-[inset_0_0_0_1px_var(--color-border)]">
            <span className="block text-[11px] text-muted-foreground">Phone battery</span>
            {a.batteryPct != null ? <Battery pct={a.batteryPct} charging={a.charging} className="text-[13px]" /> : <b className="block text-[13px]">—</b>}
          </div>
        </div>
      )}
      {canUpdate && (a.state === "location_off" || a.state === "stale") && (
        <div className="grid gap-1.5">
          <Button size="sm" disabled={!a.canNotify || nextAsk !== null} onClick={() => setAsking(true)}>
            <Send /> Ask to turn on location
          </Button>
          <span className="text-[11.5px] text-muted-foreground">
            {!a.canNotify ? (
              "Notifications are off on this phone. Call the driver instead."
            ) : nextAsk ? (
              <>Asked {a.locationAskedAt && <RelativeTime iso={a.locationAskedAt} />} · you can ask again after {new Date(nextAsk).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</>
            ) : a.locationAskedAt ? (
              <>
                Last asked <RelativeTime iso={a.locationAskedAt} />
              </>
            ) : (
              "Sends a notification with a Turn on button."
            )}
          </span>
        </div>
      )}
      {asking && <AskLocationDialog driverId={driver.id} driverName={driver.name} since={a.lastReportAt} onClose={() => setAsking(false)} onSent={onChanged} />}
      <div className="flex flex-wrap gap-2">
        {mapId && inApp && (
          <Button asChild size="sm" variant="secondary" className="flex-1">
            <Link href={`/map?focus=${mapId}`}>
              <MapPin /> See on map
            </Link>
          </Button>
        )}
        {canUpdate && onInvite && !inApp && (
          <Button size="sm" className="flex-1" onClick={onInvite}>
            <Send /> {a.inviteSentAt ? "Send a new invite" : "Send app invite"}
          </Button>
        )}
        {canUpdate && inApp && (
          <Button size="sm" variant="secondary" loading={busy} onClick={() => void signOut()} title="Sign the driver out of the app on every phone">
            <LogOut /> Sign out
          </Button>
        )}
      </div>
    </section>
  );
}
