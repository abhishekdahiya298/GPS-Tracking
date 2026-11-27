"use client";
import { AlertTriangle, ArrowRight, Clock, Map as MapIcon, MapPin, PackagePlus, PauseCircle, Package } from "lucide-react";
import { haversineMeters } from "@rio-gps/core/geo";
import { useUnits } from "@/components/app/units-context";
import { placeText, useAddressState } from "@/lib/use-address";
import { DriverAvatar } from "../drivers/drivers-view";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { FilterBar, SegmentedFilter } from "@/components/app/filter-bar";
import { RelativeTime } from "@/components/app/local-time";
import { PageHeader } from "@/components/app/page-header";
import { SearchInput } from "@/components/app/search-input";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { useTime } from "@/components/app/time-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { LOAD_STATUS_META, shortPlace } from "@/lib/load-meta";
import type { LoadSummaryDto } from "@/lib/loads";

const REFRESH_MS = 30_000;

/** Status, plus what needs attention (paused sharing, no recent location, running late). */
export function LoadStatusCell({ load }: { load: LoadSummaryDto }) {
  const m = LOAD_STATUS_META[load.status];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <StatusBadge tone={m.tone} label={m.label} pulse={load.status === "in_transit" && !load.stale && !load.sharingStopped} />
      {load.sharingStopped && (
        <Badge tone="warning">
          <PauseCircle className="size-3" aria-hidden="true" /> Driver paused
        </Badge>
      )}
      {load.stale && (
        <Badge tone="warning">
          <AlertTriangle className="size-3" aria-hidden="true" /> No recent location
        </Badge>
      )}
    </div>
  );
}

export function EtaCell({ load }: { load: LoadSummaryDto }) {
  const t = useTime();
  if (!load.eta) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col">
      <span className="tabular-nums">
        {t.dateTime(load.eta.at)} <span className="text-xs text-muted-foreground">to {load.eta.target}</span>
      </span>
      {load.eta.lateByMinutes !== null && (
        <span className={load.eta.late ? "text-xs font-medium text-danger" : "text-xs text-success"}>
          {load.eta.late ? `About ${fmtMinutes(load.eta.lateByMinutes)} late` : "On time"}
        </span>
      )}
    </div>
  );
}

export function fmtMinutes(min: number): string {
  const m = Math.abs(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** Where the load is now: full street address (coordinates until it loads) and when it was updated. */
function CurrentPlace({ load }: { load: LoadSummaryDto }) {
  const p = load.lastPosition;
  const a = useAddressState(p ? p.latitude : null, p ? p.longitude : null, (p?.speedKph ?? 0) >= 5);
  if (!p) return <span className="text-xs text-muted-foreground">No location yet</span>;
  const text = placeText(a, p.latitude, p.longitude);
  return (
    <span className="flex min-w-0 items-start gap-1">
      <MapPin className="mt-0.5 size-3.5 shrink-0 text-[#2563eb]" aria-hidden="true" />
      <span className="grid min-w-0">
        <span className="line-clamp-2 text-xs leading-4 [overflow-wrap:anywhere]" title={a.address?.label ?? text}>
          {text}
        </span>
        <span className="text-[11px] text-muted-foreground">
          <RelativeTime iso={p.at} />
        </span>
      </span>
    </span>
  );
}

/** Pickup → delivery with how far is left and the ETA. */
export function RouteCell({ load }: { load: LoadSummaryDto }) {
  const u = useUnits();
  const t = useTime();
  const total = haversineMeters([load.pickup.longitude, load.pickup.latitude], [load.delivery.longitude, load.delivery.latitude]);
  const ended = load.status === "delivered";
  const left = ended ? 0 : load.eta && load.eta.target === "delivery" ? load.eta.distanceM : total;
  const pct = ended ? 100 : total > 0 && load.eta?.target === "delivery" ? Math.min(100, Math.max(2, (1 - left / total) * 100)) : 2;
  const color = load.eta?.late ? "#b91c1c" : ended ? "#1d4ed8" : load.eta?.target === "delivery" ? "#15803d" : "#c2410c";
  return (
    <div className="grid min-w-0 gap-1">
      <span className="flex min-w-0 items-center gap-1 text-xs font-medium">
        <i className="size-2 shrink-0 rounded-full bg-[#15803d]" aria-hidden="true" />
        <span className="truncate">{shortPlace(load.pickup.name, load.pickup.address)}</span>
        <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-label="to" />
        <i className="size-2 shrink-0 rounded-full bg-[#b91c1c]" aria-hidden="true" />
        <span className="truncate">{shortPlace(load.delivery.name, load.delivery.address)}</span>
      </span>
      <span className="h-1.5 overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </span>
      <span className="flex justify-between gap-2 text-[11px]">
        <b style={{ color }}>{ended ? "Delivered" : `${u.fmtDist(left / 1000, 0)} left`}</b>
        <span className="truncate text-muted-foreground">
          {load.eta ? `ETA ${t.time(load.eta.at)}${load.eta.lateByMinutes !== null ? (load.eta.late ? ` · ${fmtMinutes(load.eta.lateByMinutes)} late` : " · on time") : ""}` : "—"}
        </span>
      </span>
    </div>
  );
}

function hm(seconds: number) {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

export function LoadsView({ loads, driven = {}, counts, filter, q, canWrite, notice, fleet = true, title = "Loads", description, tabs }: { loads: LoadSummaryDto[]; driven?: Record<string, { distanceM: number; drivingS: number }>; counts: { active: number; ended: number }; filter: "active" | "ended" | "all"; q: string; canWrite: boolean; notice?: ReactNode; fleet?: boolean; title?: string; description?: string; tabs?: ReactNode }) {
  const router = useRouter();
  const u = useUnits();
  const pathname = usePathname();
  const go = (next: { filter?: string; q?: string }) => {
    const sp = new URLSearchParams();
    const f = next.filter ?? filter;
    const s = next.q ?? q;
    if (f !== "active") sp.set("filter", f);
    if (s) sp.set("q", s);
    router.replace(`${pathname}${sp.size ? `?${sp}` : ""}`, { scroll: false });
  };

  // Live list: refresh while visible.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [router]);

  const newButton = canWrite && (
    <Button asChild variant="secondary">
      <Link href="/loads/new">
        <PackagePlus aria-hidden="true" /> New load
      </Link>
    </Button>
  );
  const headerActions = (
    <>
      <Button asChild variant="secondary">
        <Link href="/loads/map">
          <MapIcon aria-hidden="true" /> Map view
        </Link>
      </Button>
      {newButton}
    </>
  );

  return (
    <>
      <PageHeader title={title} description={description ?? (fleet ? "Track each shipment from pickup to delivery, by the driver's phone or your own trackers." : "Track each shipment from pickup to delivery with the driver's phone.")} actions={headerActions} />
      {tabs}
      {notice && <div className="mb-4">{notice}</div>}
      <Card>
        <FilterBar>
          <SegmentedFilter
            label="Show"
            value={filter}
            onChange={(v) => go({ filter: v })}
            options={[
              { value: "active", label: "Active", count: counts.active },
              { value: "ended", label: "Completed", count: counts.ended },
              { value: "all", label: "All" }
            ]}
          />
          <SearchInput value={q} onChange={(v) => go({ q: v })} placeholder="Load #, driver, carrier, city…" label="Search loads" className="sm:ml-auto" />
        </FilterBar>
        {loads.length === 0 ? (
          <EmptyState
            icon={Package}
            title={q ? "No loads match your search" : filter === "ended" ? "No completed loads yet" : "No active loads"}
            description={q ? "Try another load number, name or city." : canWrite ? "Create a load and send the driver a link. You will see them on the map as soon as they accept." : "Loads your team creates will appear here."}
            action={!q && canWrite ? newButton : undefined}
          />
        ) : (
          <>
            <Table className="min-w-[1000px] table-fixed">
              <THead>
                <TR>
                  <TH style={{ width: "15%" }}>Load</TH>
                  <TH style={{ width: "24%" }}>Route · remaining</TH>
                  <TH style={{ width: "16%" }}>Driver · vehicle</TH>
                  <TH style={{ width: "11%" }}>Last 24 h</TH>
                  <TH style={{ width: "25%" }}>Current location</TH>
                  <TH style={{ width: "9%" }} className="text-right">
                    <span className="sr-only">Actions</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {loads.map((l) => {
                  const d = driven[l.id];
                  const who = l.driverName ?? l.driverPhone;
                  return (
                    <TR key={l.id} className="cursor-pointer" onClick={() => router.push(`/loads/${l.id}`)}>
                      <TD className="overflow-hidden py-2">
                        <div className="grid min-w-0 gap-1">
                          <Link href={`/loads/${l.id}`} className="truncate font-bold text-primary no-underline hover:underline" onClick={(e) => e.stopPropagation()}>
                            {l.reference}
                          </Link>
                          {l.carrierName && <span className="truncate text-xs text-muted-foreground">{l.carrierName}</span>}
                          <LoadStatusCell load={l} />
                        </div>
                      </TD>
                      <TD className="overflow-hidden py-2">
                        <RouteCell load={l} />
                      </TD>
                      <TD className="overflow-hidden py-2">
                        {who || l.vehicle ? (
                          <div className="grid min-w-0 gap-0.5">
                            {who && (
                              <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold">
                                <DriverAvatar name={who} className="size-5 text-[9px]" />
                                <span className="truncate">{who}</span>
                              </span>
                            )}
                            <span className="truncate text-xs text-muted-foreground">{l.vehicle ? l.vehicle.name : "Driver's phone"}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Link sent</span>
                        )}
                      </TD>
                      <TD className="overflow-hidden py-2">
                        {d ? (
                          <div className="grid gap-0.5 tabular-nums">
                            <b className="text-sm">{u.fmtDist(d.distanceM / 1000, 0)}</b>
                            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                              <Clock className="size-3" aria-hidden="true" /> {hm(d.drivingS)} driving
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TD>
                      <TD className="overflow-hidden py-2">
                        <CurrentPlace load={l} />
                      </TD>
                      <TD className="py-2 text-right">
                        <Button asChild size="icon-sm" variant="secondary" aria-label={`Show ${l.reference} on the loads map`} title="Show on the loads map">
                          <Link href={`/loads/map?focus=${l.id}`} onClick={(e) => e.stopPropagation()}>
                            <MapIcon aria-hidden="true" />
                          </Link>
                        </Button>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <p className="m-0 border-t border-border px-4 py-2 text-xs text-muted-foreground">Driven figures are the last 24 hours. Addresses update as the load moves.</p>
          </>
        )}
      </Card>
    </>
  );
}
