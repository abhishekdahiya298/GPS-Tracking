"use client";
import { AlertTriangle, ArrowRight, PackagePlus, PauseCircle, Package } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
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

export function LoadsView({ loads, counts, filter, q, canWrite }: { loads: LoadSummaryDto[]; counts: { active: number; ended: number }; filter: "active" | "ended" | "all"; q: string; canWrite: boolean }) {
  const router = useRouter();
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

  return (
    <>
      <PageHeader title="Loads" description="Track each shipment through the driver's phone, from pickup to delivery." actions={newButton} />
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
          <Table>
            <THead>
              <TR>
                <TH>Load</TH>
                <TH>Lane</TH>
                <TH>Driver</TH>
                <TH>Status</TH>
                <TH>Last location</TH>
                <TH>ETA</TH>
              </TR>
            </THead>
            <TBody>
              {loads.map((l) => (
                <TR key={l.id} className="cursor-pointer" onClick={() => router.push(`/loads/${l.id}`)}>
                  <TD className="whitespace-nowrap font-medium">
                    <Link href={`/loads/${l.id}`} className="text-primary no-underline hover:underline" onClick={(e) => e.stopPropagation()}>
                      {l.reference}
                    </Link>
                  </TD>
                  <TD>
                    <span className="inline-flex flex-wrap items-center gap-1">
                      {shortPlace(l.pickup.name, l.pickup.address)} <ArrowRight className="size-3.5 text-muted-foreground" aria-label="to" /> {shortPlace(l.delivery.name, l.delivery.address)}
                    </span>
                  </TD>
                  <TD>
                    <div className="flex flex-col">
                      <span>{l.driverName ?? l.driverPhone ?? l.vehicle?.name ?? "—"}</span>
                      {(l.vehicle || l.carrierName) && <span className="text-xs text-muted-foreground">{[l.vehicle && `Tracker: ${l.vehicle.name}`, l.carrierName].filter(Boolean).join(" · ")}</span>}
                    </div>
                  </TD>
                  <TD>
                    <LoadStatusCell load={l} />
                  </TD>
                  <TD className="whitespace-nowrap text-muted-foreground">{l.lastPosition ? <RelativeTime iso={l.lastPosition.at} /> : "—"}</TD>
                  <TD className="whitespace-nowrap">
                    <EtaCell load={l} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
