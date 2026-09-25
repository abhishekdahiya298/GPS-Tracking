"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { BellOff, BellRing, CheckCheck, Check, MapPinned, RefreshCw, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DataTable, type ColumnMeta } from "@/components/app/data-table";
import { SegmentedFilter } from "@/components/app/filter-bar";
import { PageHeader } from "@/components/app/page-header";
import { SearchInput } from "@/components/app/search-input";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { useUnits } from "@/components/app/units-context";
import { useListParams } from "@/components/app/use-list-params";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toaster";
import type { AlertEventDto, AlertRuleDto } from "@/lib/alerts";
import type { AlertListQuery, AlertPage } from "@/lib/alerts-list";
import { api, errorMessage } from "@/lib/client/api";
import { alertMapHref, describeAlert, SEVERITY, TYPE_LABEL } from "./alert-meta";
import { RulesPanel } from "./rules-panel";

type Ref = { id: string; name: string };

export function AlertsView({ data, query, rules, geofences, vehicles, canWrite, canMap }: { data: AlertPage; query: AlertListQuery; rules: AlertRuleDto[]; geofences: Ref[]; vehicles: Ref[]; canWrite: boolean; canMap: boolean }) {
  const u = useUnits();
  const { set, refresh, pending } = useListParams();
  const [detail, setDetail] = useState<AlertEventDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [incoming, setIncoming] = useState(0);
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const filtered = query.status !== "all" || query.type !== "all" || query.search !== "" || !!query.from || !!query.to;
  const onFirstPage = query.page === 1 && !filtered;

  // Live: new alerts arrive on the authenticated stream. On an unfiltered first page the list refreshes
  // itself; otherwise a "new alerts" button appears so the user's view doesn't jump.
  useEffect(() => {
    const es = new EventSource("/api/locations/stream");
    es.addEventListener("alert", (ev) => {
      const a = JSON.parse((ev as MessageEvent).data) as AlertEventDto;
      toast.warning(describeAlert(a, u), { description: a.ruleName });
      if (onFirstPage) refresh();
      else setIncoming((n) => n + 1);
    });
    return () => es.close();
  }, [onFirstPage, refresh, u]);

  async function ack(ids: number[] | "all") {
    setBusy(true);
    try {
      await api("/api/alerts/acknowledge", { method: "POST", json: ids === "all" ? { all: true } : { ids } });
      toast.success(ids === "all" ? "All alerts acknowledged." : "Alert acknowledged.");
      if (detail && (ids === "all" || ids.includes(detail.id))) setDetail({ ...detail, acknowledgedAt: new Date().toISOString() });
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  const columns = useMemo<ColumnDef<AlertEventDto, unknown>[]>(
    () => [
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (row.original.acknowledgedAt ? <StatusBadge tone="neutral" label="Acknowledged" /> : <StatusBadge tone="primary" label="New" />)
      },
      {
        id: "alert",
        header: "Alert",
        cell: ({ row }) => {
          const e = row.original;
          const sev = SEVERITY[e.type] ?? SEVERITY.ignition_on!;
          return (
            <div className="min-w-0">
              <div className={e.acknowledgedAt ? "font-normal" : "font-medium"}>{describeAlert(e, u)}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <StatusBadge tone={sev.tone} label={sev.label} />
                {TYPE_LABEL[e.type]} · {e.ruleName}
              </div>
            </div>
          );
        }
      },
      { id: "time", header: "Time", meta: { className: "whitespace-nowrap" } as ColumnMeta, cell: ({ row }) => when(row.original.occurredAt) },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        meta: { className: "text-right w-0 whitespace-nowrap" } as ColumnMeta,
        cell: ({ row }) => {
          const e = row.original;
          const href = canMap ? alertMapHref(e) : null;
          return (
            <div className="flex justify-end gap-1" onClick={(ev) => ev.stopPropagation()}>
              {href && (
                <Button asChild variant="ghost" size="sm">
                  <Link href={href} aria-label="Show on map">
                    <MapPinned />
                  </Link>
                </Button>
              )}
              {canWrite && !e.acknowledgedAt && (
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => ack([e.id])}>
                  <Check /> Acknowledge
                </Button>
              )}
            </div>
          );
        }
      }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [u, canWrite, canMap, busy]
  );

  return (
    <>
      <PageHeader
        title="Alerts"
        description="Speeding, zone, ignition and offline alerts for your fleet, and the rules that create them."
        actions={
          canWrite &&
          data.counts.unack > 0 && (
            <Button variant="secondary" loading={busy} onClick={() => ack("all")}>
              <CheckCheck /> Acknowledge all
            </Button>
          )
        }
      />
      <Tabs defaultValue="history">
        <TabsList className="mb-4">
          <TabsTrigger value="history">
            History{data.counts.unack > 0 ? ` (${data.counts.unack} new)` : ""}
          </TabsTrigger>
          <TabsTrigger value="rules">Rules ({rules.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="history">
          {incoming > 0 && (
            <div className="mb-3">
              <Button
                size="sm"
                onClick={() => {
                  setIncoming(0);
                  refresh();
                }}
              >
                <RefreshCw /> {incoming} new alert{incoming === 1 ? "" : "s"}, refresh
              </Button>
            </div>
          )}
          <Card>
            <DataTable<AlertEventDto>
              columns={columns}
              data={data.items}
              getRowId={(e) => String(e.id)}
              total={data.total}
              page={data.page}
              pageSize={data.pageSize}
              sort="time"
              direction="desc"
              onSort={() => undefined}
              onPage={(p) => set({ page: p })}
              onRowClick={setDetail}
              rowLabel={(e) => `Open alert: ${describeAlert(e, u)}`}
              loading={pending}
              toolbar={
                <div className="flex w-full flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
                  <SearchInput value={query.search} onChange={(v) => set({ search: v })} placeholder="Search vehicle or rule…" label="Search alerts" className="lg:w-64" />
                  <SegmentedFilter
                    label="Filter by status"
                    value={query.status}
                    onChange={(v) => set({ status: v === "all" ? null : v })}
                    options={[
                      { value: "all", label: "All", count: data.counts.all },
                      { value: "unack", label: "New", count: data.counts.unack },
                      { value: "ack", label: "Acknowledged", count: data.counts.all - data.counts.unack }
                    ]}
                  />
                  <Select aria-label="Alert type" className="lg:w-44" value={query.type} onChange={(e) => set({ type: e.target.value === "all" ? null : e.target.value })}>
                    <option value="all">All types</option>
                    {Object.entries(TYPE_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                  <div className="flex items-center gap-2">
                    <Input type="date" aria-label="From date" className="w-[150px]" value={query.from ?? ""} max={query.to} onChange={(e) => set({ from: e.target.value || null, tz })} />
                    <span className="text-xs text-muted-foreground">to</span>
                    <Input type="date" aria-label="To date" className="w-[150px]" value={query.to ?? ""} min={query.from} onChange={(e) => set({ to: e.target.value || null, tz })} />
                  </div>
                  {filtered && (
                    <Button variant="ghost" size="sm" onClick={() => set({ search: null, status: null, type: null, from: null, to: null, tz: null })}>
                      Clear filters
                    </Button>
                  )}
                </div>
              }
              mobileRow={(e) => (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 text-sm">
                    <div className={e.acknowledgedAt ? "" : "font-medium"}>{describeAlert(e, u)}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {e.acknowledgedAt ? <StatusBadge tone="neutral" label="Acknowledged" /> : <StatusBadge tone="primary" label="New" />}
                      {when(e.occurredAt)}
                    </div>
                  </div>
                </div>
              )}
              empty={
                filtered ? (
                  <EmptyState icon={BellOff} title="No alerts match these filters" action={<Button variant="secondary" size="sm" onClick={() => set({ search: null, status: null, type: null, from: null, to: null, tz: null })}>Clear filters</Button>} />
                ) : (
                  <EmptyState icon={ShieldAlert} title="No alerts yet" description={rules.length ? "Alerts appear here as soon as a rule fires." : "Create a rule (for example a speed limit or a zone) to get alerted."} />
                )
              }
            />
          </Card>
        </TabsContent>

        <TabsContent value="rules">
          <RulesPanel rules={rules} geofences={geofences} vehicles={vehicles} canWrite={canWrite} onChanged={refresh} />
        </TabsContent>
      </Tabs>

      <Sheet open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        {detail && (
          <SheetContent title={describeAlert(detail, u)} description={`${TYPE_LABEL[detail.type]} · ${detail.ruleName}`}>
            <div className="p-5">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="m-0">{detail.acknowledgedAt ? `Acknowledged ${new Date(detail.acknowledgedAt).toLocaleString()}` : "New"}</dd>
              <dt className="text-muted-foreground">Severity</dt>
              <dd className="m-0">
                <StatusBadge tone={(SEVERITY[detail.type] ?? SEVERITY.ignition_on!).tone} label={(SEVERITY[detail.type] ?? SEVERITY.ignition_on!).label} />
              </dd>
              <dt className="text-muted-foreground">Vehicle</dt>
              <dd className="m-0">{detail.vehicleName ?? "—"}</dd>
              <dt className="text-muted-foreground">Time</dt>
              <dd className="m-0">{new Date(detail.occurredAt).toLocaleString()}</dd>
              {detail.latitude !== null && detail.longitude !== null && (
                <>
                  <dt className="text-muted-foreground">Location</dt>
                  <dd className="m-0 tabular-nums">
                    {detail.latitude.toFixed(5)}, {detail.longitude.toFixed(5)}
                  </dd>
                </>
              )}
            </dl>
            <div className="mt-5 flex flex-wrap gap-2">
              {canMap && alertMapHref(detail) && (
                <Button asChild variant="secondary">
                  <Link href={alertMapHref(detail)!}>
                    <MapPinned /> Show track on map
                  </Link>
                </Button>
              )}
              {canWrite && !detail.acknowledgedAt && (
                <Button loading={busy} onClick={() => ack([detail.id])}>
                  <BellRing /> Acknowledge
                </Button>
              )}
            </div>
            </div>
          </SheetContent>
        )}
      </Sheet>
    </>
  );
}
