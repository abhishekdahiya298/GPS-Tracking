"use client";
import { isLoadEnded } from "@rio-gps/core/loads";
import { CheckCircle2, Link2, MoreHorizontal, Pencil, Phone, Send, Share2, Trash2, Truck, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { LoadMap } from "@/components/app/load-map";
import { RelativeTime } from "@/components/app/local-time";
import { PageHeader } from "@/components/app/page-header";
import { useTime } from "@/components/app/time-context";
import { useUnits } from "@/components/app/units-context";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import { fmtDistanceM, LOAD_EVENT_LABEL, shortPlace } from "@/lib/load-meta";
import type { DriverShare, LoadDetailDto, LoadStopDto } from "@/lib/loads";
import type { SmsResult } from "@/lib/sms";
import { CopyLink, ShareDriverLink, SmsOutcome } from "../load-form";
import { EtaCell, LoadStatusCell } from "../loads-view";

const REFRESH_MS = 20_000;

function StopCard({ title, color, stop, arrivedAt, departedAt }: { title: string; color: string; stop: LoadStopDto; arrivedAt?: string; departedAt?: string }) {
  const t = useTime();
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span aria-hidden="true" className="inline-block size-2.5 rounded-full" style={{ background: color }} />
        {title}
      </div>
      <p className="m-0 font-medium">{shortPlace(stop.name, stop.address)}</p>
      {shortPlace(stop.name, stop.address) !== stop.address && <p className="m-0 text-sm text-muted-foreground">{stop.address}</p>}
      <p className="m-0 text-sm">
        {stop.appointmentAt ? (
          <>
            Appointment <span className="tabular-nums">{t.dateTime(stop.appointmentAt)}</span>
          </>
        ) : (
          <span className="text-muted-foreground">No appointment</span>
        )}
      </p>
      {(arrivedAt || departedAt) && (
        <p className="m-0 text-sm text-muted-foreground">
          {arrivedAt && <>Arrived {t.dateTime(arrivedAt)}</>}
          {arrivedAt && departedAt && " · "}
          {departedAt && <>Left {t.dateTime(departedAt)}</>}
        </p>
      )}
    </div>
  );
}

type LinkDialog = { kind: "driver"; link: string; sms: SmsResult | null; share: DriverShare } | { kind: "shipper"; link: string } | null;

export function LoadDetail({ initial, canWrite }: { initial: LoadDetailDto; canWrite: boolean }) {
  const router = useRouter();
  const t = useTime();
  const u = useUnits();
  const [load, setLoad] = useState(initial);
  const [confirm, setConfirm] = useState<"delivered" | "cancel" | "delete" | "driver-link" | null>(null);
  const [dialog, setDialog] = useState<LinkDialog>(null);
  const [busy, setBusy] = useState(false);
  const [shipperBusy, setShipperBusy] = useState(false);
  const ended = isLoadEnded(load.status);

  const refresh = useCallback(async () => {
    try {
      setLoad(await api<LoadDetailDto>(`/api/loads/${initial.id}`));
    } catch {
      // keep the last view; the next refresh retries
    }
  }, [initial.id]);

  useEffect(() => {
    if (ended) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [ended, refresh]);

  const firstAt = (type: string) => load.events.find((e) => e.type === type)?.at;

  async function outcome(action: "delivered" | "cancel") {
    try {
      setLoad(await api<LoadDetailDto>(`/api/loads/${load.id}/status`, { method: "POST", json: { action } }));
      toast.success(action === "delivered" ? "Marked delivered. Tracking has stopped." : "Load cancelled. Tracking has stopped.");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function newDriverLink(send: boolean) {
    setBusy(true);
    try {
      const r = await api<{ driverLink: string; sms: SmsResult | null; share: DriverShare }>(`/api/loads/${load.id}/driver-link`, { method: "POST", json: { send } });
      setDialog({ kind: "driver", link: r.driverLink, sms: r.sms, share: r.share });
      void refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  async function shipperLink() {
    setShipperBusy(true);
    try {
      const r = await api<{ shipperLink: string }>(`/api/loads/${load.id}/shipper-link`, { method: "POST" });
      setDialog({ kind: "shipper", link: r.shipperLink });
      void refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setShipperBusy(false);
    }
  }

  async function revokeShipper() {
    try {
      await api(`/api/loads/${load.id}/shipper-link`, { method: "DELETE" });
      toast.success("Shipper link turned off.");
      void refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const actions = canWrite && (
    <>
      {!ended && load.trackingMode === "phone" && (
        <Button variant="secondary" onClick={() => setConfirm("driver-link")} >
          <Send aria-hidden="true" /> Driver link
        </Button>
      )}
      {load.status !== "cancelled" && load.status !== "declined" && (
        <Button variant="secondary" onClick={() => void shipperLink()} loading={shipperBusy}>
          <Share2 aria-hidden="true" /> Shipper link
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="icon" aria-label="More actions">
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {!ended && (
            <>
              <DropdownMenuItem asChild>
                <Link href={`/loads/${load.id}/edit`}>
                  <Pencil className="size-4" aria-hidden="true" /> Edit load
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setConfirm("delivered")}>
                <CheckCircle2 className="size-4" aria-hidden="true" /> Mark delivered
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setConfirm("cancel")}>
                <XCircle className="size-4" aria-hidden="true" /> Cancel load
              </DropdownMenuItem>
            </>
          )}
          {load.hasShipperLink && (
            <DropdownMenuItem onSelect={() => void revokeShipper()}>
              <Link2 className="size-4" aria-hidden="true" /> Turn off shipper link
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => setConfirm("delete")}>
            <Trash2 className="size-4" aria-hidden="true" /> Delete load
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  return (
    <>
      <PageHeader
        title={`Load ${load.reference}`}
        description={`${shortPlace(load.pickup.name, load.pickup.address)} → ${shortPlace(load.delivery.name, load.delivery.address)}`}
        breadcrumbs={[{ label: "Loads", href: "/loads" }, { label: load.reference }]}
        actions={actions}
      />

      {load.status === "invited" && (
        <Alert tone="info" className="mb-4" title="Waiting for the driver to accept.">
          {load.inviteSentAt ? <>Invite texted {t.dateTime(load.inviteSentAt)}. </> : <>Send the driver their link if you haven&apos;t yet. </>}
          {canWrite && "Lost the link? Use Driver link to make a new one."}
        </Alert>
      )}
      {load.sharingStopped && (
        <Alert tone="warning" className="mb-4" title="The driver paused location sharing.">
          Call them to check in. Tracking continues when they tap Share again on their link.
        </Alert>
      )}
      {load.stale && !load.sharingStopped && (
        <Alert tone="warning" className="mb-4" title="No location in the last 30 minutes.">
          {load.trackingMode === "vehicle"
            ? "The vehicle's tracker hasn't reported. It may be parked with the engine off, or out of coverage."
            : "The driver's page may be closed or their phone offline. Positions sent while offline arrive when they reconnect."}
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="h-[420px] overflow-hidden p-0 lg:h-[560px]">
          <LoadMap pickup={load.pickup} delivery={load.delivery} trail={load.trail} position={ended ? null : load.lastPosition} label={`Map of load ${load.reference}`} className="rounded-none" />
        </Card>

        <div className="grid content-start gap-4">
          <Card>
            <CardContent className="grid gap-3">
              <LoadStatusCell load={load} />
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Last location</dt>
                <dd className="m-0">{load.lastPosition ? <RelativeTime iso={load.lastPosition.at} /> : "None yet"}</dd>
                <dt className="text-muted-foreground">ETA</dt>
                <dd className="m-0">
                  <EtaCell load={load} />
                </dd>
                {load.eta && (
                  <>
                    <dt className="text-muted-foreground">Remaining</dt>
                    <dd className="m-0">About {fmtDistanceM(load.eta.distanceM, u.system === "imperial")}</dd>
                  </>
                )}
                {load.endedAt && (
                  <>
                    <dt className="text-muted-foreground">Ended</dt>
                    <dd className="m-0">{t.dateTime(load.endedAt)}</dd>
                  </>
                )}
              </dl>
              {load.eta && <p className="m-0 text-xs text-muted-foreground">ETA is an estimate from straight-line distance and average truck speed.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="grid gap-4">
              <StopCard title="Pickup" color="#0e7c66" stop={load.pickup} arrivedAt={firstAt("arrived_pickup")} departedAt={firstAt("departed_pickup")} />
              <StopCard title="Delivery" color="#d81e2c" stop={load.delivery} arrivedAt={firstAt("arrived_delivery")} departedAt={firstAt("departed_delivery")} />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="grid gap-1 text-sm">
              {load.vehicle && (
                <p className="m-0 mb-1 flex items-center gap-1.5">
                  <Truck className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span>
                    Tracked by <span className="font-medium">{load.vehicle.name}</span>&apos;s RIO tracker
                  </span>
                </p>
              )}
              <p className="m-0 font-medium">{load.driverName ?? "Driver"}</p>
              {load.driverPhone && (
                <a href={`tel:${load.driverPhone}`} className="inline-flex w-fit items-center gap-1.5 text-primary no-underline hover:underline">
                  <Phone className="size-3.5" aria-hidden="true" /> {load.driverPhone}
                </a>
              )}
              {load.carrierName && <p className="m-0 text-muted-foreground">{load.carrierName}</p>}
              {load.notes && <p className="m-0 mt-2 whitespace-pre-wrap border-t border-border pt-2 text-muted-foreground">{load.notes}</p>}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="m-0 grid list-none gap-3 p-0">
            {[...load.events].reverse().map((e, i) => (
              <li key={`${e.type}-${e.at}-${i}`} className="flex gap-3 text-sm">
                <span className="w-32 shrink-0 tabular-nums text-muted-foreground">{t.dateTime(e.at)}</span>
                <span>
                  {LOAD_EVENT_LABEL[e.type] ?? e.type}
                  {e.actorName && <span className="text-muted-foreground"> · {e.actorName}</span>}
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Dialog open={confirm === "driver-link"} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent title="New driver link" description="The driver's current link stops working. If they already accepted, they keep sharing once they open the new link.">
          <p className="m-0 text-sm">Send it to {load.driverName ?? "the driver"} at {load.driverPhone}.</p>
          <DialogFooter>
            {load.smsAvailable && (
              <Button variant="secondary" onClick={() => void newDriverLink(true)} loading={busy}>
                <Send aria-hidden="true" /> Text it automatically
              </Button>
            )}
            <Button onClick={() => void newDriverLink(false)} loading={busy}>
              Get the link to send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        {dialog && (
          <DialogContent
            title={dialog.kind === "driver" ? "Driver link" : "Shipper tracking link"}
            description={dialog.kind === "driver" ? "Shown only now." : "Read-only: status, ETA and the truck's position. It never shows the driver's name or phone. Making a new one turns this one off."}
          >
            <div className="grid gap-3">
              {dialog.kind === "driver" && <SmsOutcome sms={dialog.sms} smsAvailable={load.smsAvailable} />}
              {dialog.kind === "driver" ? <ShareDriverLink link={dialog.link} share={dialog.share} /> : <CopyLink link={dialog.link} label="Shipper link" />}
            </div>
            <DialogFooter>
              <Button onClick={() => setDialog(null)}>Done</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <ConfirmDialog
        open={confirm === "delivered" || confirm === "cancel"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === "delivered" ? "Mark this load delivered?" : "Cancel this load?"}
        description="Tracking stops and the driver's link stops sending locations. This can't be undone."
        confirmLabel={confirm === "delivered" ? "Mark delivered" : "Cancel load"}
        destructive={confirm === "cancel"}
        onConfirm={() => outcome(confirm === "delivered" ? "delivered" : "cancel")}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Delete load ${load.reference}?`}
        description="Its locations and timeline are deleted too, and all its links stop working. This can't be undone."
        confirmLabel="Delete load"
        destructive
        onConfirm={async () => {
          try {
            await api(`/api/loads/${load.id}`, { method: "DELETE" });
            toast.success(`Load ${load.reference} deleted.`);
            router.push("/loads");
            router.refresh();
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
    </>
  );
}
