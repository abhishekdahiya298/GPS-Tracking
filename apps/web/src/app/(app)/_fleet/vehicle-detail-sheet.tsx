"use client";
import { AlertTriangle, IdCard, History, Map as MapIcon, Navigation } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { startOfLocalDay } from "@rio-gps/core/timezones";
import { LocalTime, RelativeTime } from "@/components/app/local-time";
import { useTime } from "@/components/app/time-context";
import { ErrorState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { useUnits } from "@/components/app/units-context";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { alertMeta } from "@/lib/alert-meta";
import type { AlertEventDto } from "@/lib/alerts";
import { api, errorMessage } from "@/lib/client/api";
import type { VehicleDetail } from "@/lib/fleet-list";
import { VehicleStateBadge } from "./vehicle-state";
import { deviceDisplayName, productName } from "@/lib/device-name";
import { pictureState, VehiclePicture } from "@/components/app/vehicle-picture";
import { asVehicleType, VEHICLE_TYPE_LABEL } from "@/lib/schemas/vehicle";

type Detail = VehicleDetail & { alerts: AlertEventDto[] };

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (deg: number | null) => (deg === null ? "—" : `${COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]} (${Math.round(deg)}°)`);

export function VehicleDetailSheet({ vehicleId, onOpenChange, actions }: { vehicleId: string | null; onOpenChange: (open: boolean) => void; actions?: (d: Detail) => ReactNode }) {
  const u = useUnits();
  const time = useTime();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!vehicleId) return;
    let live = true;
    setDetail(null);
    setError(null);
    api<Detail>(`/api/vehicles/${vehicleId}`)
      .then((d) => live && setDetail(d))
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [vehicleId, nonce]);

  const loc = detail?.location;
  const today = startOfLocalDay(time.dayKey(Date.now()), time.timeZone); // local midnight in the viewer's zone

  return (
    <Sheet open={vehicleId !== null} onOpenChange={onOpenChange}>
      <SheetContent title={detail?.vehicle.name ?? "Vehicle"} description={detail?.vehicle.licensePlate ?? undefined}>
        {error ? (
          <ErrorState title="Unable to load this vehicle" description={error} action={<Button variant="secondary" onClick={() => setNonce((n) => n + 1)}>Try again</Button>} />
        ) : !detail ? (
          <div className="grid gap-3 p-5" aria-busy="true">
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <div className="grid gap-5 p-5">
            <div className="flex items-center gap-4 rounded-xl border border-border p-3" style={{ backgroundImage: "linear-gradient(135deg, var(--color-background) 30%, var(--color-primary-soft) 100%)" }}>
              <VehiclePicture type={detail.vehicle.type} state={pictureState(detail.device ? detail.state : null)} className="h-20 w-28 shrink-0 rounded-xl" />
              <div className="min-w-0">
                <p className="m-0 truncate text-lg font-bold">{detail.vehicle.name}</p>
                <p className="m-0 truncate text-sm text-muted-foreground">{[VEHICLE_TYPE_LABEL[asVehicleType(detail.vehicle.type)], detail.vehicle.licensePlate].filter(Boolean).join(" · ")}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <VehicleStateBadge state={detail.state} />
              {detail.vehicle.status !== "active" && <StatusBadge tone="warning" label={detail.vehicle.status === "maintenance" ? "In maintenance" : "Inactive"} />}
              <span className="text-sm text-muted-foreground">Last seen <RelativeTime iso={detail.lastSeenAt} /></span>
            </div>

            {loc && (
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link href={`/map?focus=${detail.device!.id}`}>
                    <MapIcon aria-hidden="true" /> Show on map
                  </Link>
                </Button>
                <Button asChild size="sm" variant="secondary">
                  <Link href={`/map?device=${detail.device!.id}&from=${encodeURIComponent(today.toISOString())}&to=${encodeURIComponent(new Date().toISOString())}`}>
                    <History aria-hidden="true" /> Today&apos;s track
                  </Link>
                </Button>
                {actions?.(detail)}
              </div>
            )}
            {!loc && actions && <div className="flex flex-wrap gap-2">{actions(detail)}</div>}

            <section aria-labelledby="vd-now">
              <h3 id="vd-now" className="m-0 mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Current position
              </h3>
              {loc ? (
                <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-border p-4 text-sm">
                  <Item label="Speed" value={u.fmtSpeed(loc.speedKph)} />
                  <Item label="Heading" value={<span className="inline-flex items-center gap-1"><Navigation className="size-3.5" style={{ transform: `rotate(${loc.headingDeg ?? 0}deg)` }} aria-hidden="true" />{compass(loc.headingDeg)}</span>} />
                  <Item label="Ignition" value={loc.ignition === null ? "Unknown" : loc.ignition ? "On" : "Off"} />
                  <Item label="GPS fix" value={<LocalTime iso={loc.recordedAt} />} />
                  <Item label="Coordinates" value={<span className="font-mono text-xs">{loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}</span>} wide />
                </dl>
              ) : (
                <p className="m-0 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">{detail.device ? "No position received yet." : "Assign a GPS device to see this vehicle's position."}</p>
              )}
            </section>

            <section aria-labelledby="vd-driver">
              <h3 id="vd-driver" className="m-0 mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Driver
              </h3>
              <div className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm">
                <IdCard className="size-5 shrink-0 text-[#0f766e]" aria-hidden="true" />
                {detail.driver ? (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{detail.driver.name}</span>
                    {detail.driver.phone && (
                      <a href={`tel:${detail.driver.phone}`} className="text-xs text-primary no-underline hover:underline">
                        {detail.driver.phone}
                      </a>
                    )}
                  </span>
                ) : (
                  <span className="flex-1 text-muted-foreground">No driver assigned.</span>
                )}
                <Link href={`/drivers${detail.driver ? `?search=${encodeURIComponent(detail.driver.name)}` : ""}`} className="shrink-0 text-xs font-medium text-primary no-underline hover:underline">
                  {detail.driver ? "Manage" : "Assign driver"}
                </Link>
              </div>
            </section>

            <section aria-labelledby="vd-device">
              <h3 id="vd-device" className="m-0 mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                GPS device
              </h3>
              {detail.device ? (
                <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-border p-4 text-sm">
                  <Item label="Device" value={deviceDisplayName(detail.device.name, detail.device.model)} />
                  <Item label="Product" value={productName(detail.device.model)} />
                  {detail.device.imeiLast4 && <Item label="IMEI" value={`…${detail.device.imeiLast4}`} />}
                  <Item label="Assigned" value={<LocalTime iso={detail.device.assignedAt} />} />
                </dl>
              ) : (
                <p className="m-0 text-sm text-muted-foreground">No device assigned.</p>
              )}
            </section>

            {detail.alerts.length > 0 && (
              <section aria-labelledby="vd-alerts">
                <h3 id="vd-alerts" className="m-0 mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Recent alerts
                </h3>
                <ul className="m-0 list-none divide-y divide-border rounded-lg border border-border p-0">
                  {detail.alerts.map((a) => (
                    <li key={a.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <AlertTriangle className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="flex-1 truncate">{alertMeta(a.type).label}</span>
                      <span className="text-xs text-muted-foreground"><RelativeTime iso={a.occurredAt} /></span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Item({ label, value, wide }: { label: string; value: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 mt-0.5 font-medium text-foreground">{value}</dd>
    </div>
  );
}
