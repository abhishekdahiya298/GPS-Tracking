"use client";
import { BellOff, BellRing, CheckCheck, Check, Gauge, Hexagon, Layers, LogIn, LogOut, MapPinned, Package, Plus, Power, RefreshCw, ShieldAlert, WifiOff } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FilterTiles, type TileOption } from "@/components/app/list-kit";
import { RelativeTime } from "@/components/app/local-time";
import { PageHeader } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { SearchInput } from "@/components/app/search-input";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { useTime } from "@/components/app/time-context";
import { useUnits } from "@/components/app/units-context";
import { useListParams } from "@/components/app/use-list-params";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import type { AlertEventDto, AlertRuleDto } from "@/lib/alerts";
import { kindOf, type AlertKind } from "@/lib/alert-kinds";
import type { AlertListQuery, AlertPage } from "@/lib/alerts-list";
import { api, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import { alertMapHref, describeAlert, SEVERITY, SEVERITY_COLOR, TYPE_LABEL } from "./alert-meta";
import { RulesPanel } from "./rules-panel";

const TYPE_ICON: Record<string, typeof Gauge> = { speeding: Gauge, device_offline: WifiOff, geofence_enter: LogIn, geofence_exit: LogOut, ignition_on: Power, ignition_off: Power };
const tint = (c: string, pct = 18) => `color-mix(in srgb, ${c} ${pct}%, var(--color-background))`;
const sevOf = (type: string) => SEVERITY[type] ?? SEVERITY.ignition_on!;

/** Filter tiles: every category keeps its colour and icon wherever it appears. */
const KIND_TILE: Record<AlertKind, { label: string; icon: typeof Gauge; color: string }> = {
  speeding: { label: "Speeding", icon: Gauge, color: "#c42121" },
  zone: { label: "Zones", icon: Hexagon, color: "#7c3aed" },
  offline: { label: "Offline", icon: WifiOff, color: "#64748b" },
  ignition: { label: "Ignition", icon: Power, color: "#0f766e" },
  load: { label: "Loads", icon: Package, color: "#c2410c" }
};

/** The alert's icon in a tile of its severity colour, like the phone app. */
function AlertTile({ type, color }: { type: string; color: string }) {
  const Icon = TYPE_ICON[type] ?? (type.startsWith("load_") ? Package : BellRing);
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-xl text-white shadow-sm" style={{ background: `linear-gradient(150deg, color-mix(in srgb, ${color} 75%, #fff), ${color})` }}>
      <Icon className="size-[18px]" aria-hidden="true" />
    </span>
  );
}

type Ref = { id: string; name: string };

export function AlertsView({ data, query, rules, geofences, vehicles, canWrite, canMap }: { data: AlertPage; query: AlertListQuery; rules: AlertRuleDto[]; geofences: Ref[]; vehicles: Ref[]; canWrite: boolean; canMap: boolean }) {
  const u = useUnits();
  const { set, refresh, pending } = useListParams();
  const [detail, setDetail] = useState<AlertEventDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [incoming, setIncoming] = useState(0);
  const [creating, setCreating] = useState(false);
  const time = useTime();
  const filtered = query.status !== "all" || query.type !== "all" || query.kind !== "all" || query.search !== "" || !!query.from || !!query.to;
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

  type View = "all" | "new" | AlertKind;
  const view: View = query.kind !== "all" ? query.kind : query.status === "unack" ? "new" : "all";
  const tiles: TileOption<View>[] = [
    { value: "all", label: "All", count: data.counts.all, icon: Layers, color: "#133a8f" },
    { value: "new", label: "New", count: data.counts.unack, icon: BellRing, color: "#d81e2c" },
    ...(Object.keys(KIND_TILE) as AlertKind[])
      .filter((k) => data.counts.byKind[k] > 0 || view === k)
      .map((k) => ({ value: k, label: KIND_TILE[k].label, count: data.counts.byKind[k], icon: KIND_TILE[k].icon, color: KIND_TILE[k].color }))
  ];
  const clearAll = () => set({ search: null, status: null, type: null, kind: null, from: null, to: null, tz: null });

  // Group the page into local days, newest first: "Today", "Yesterday", then dates.
  const groups = useMemo(() => {
    const today = time.dayKey(Date.now());
    const yesterday = time.dayKey(Date.now() - 86_400_000);
    const out: { key: string; label: string; items: AlertEventDto[] }[] = [];
    for (const a of data.items) {
      const k = time.dayKey(a.occurredAt);
      let g = out.at(-1);
      if (!g || g.key !== k) {
        g = { key: k, label: k === today ? "Today" : k === yesterday ? "Yesterday" : time.day(k), items: [] };
        out.push(g);
      }
      g.items.push(a);
    }
    return out;
  }, [data.items, time]);

  return (
    <>
      <PageHeader
        title="Alerts"
        description={data.counts.unack > 0 ? `${data.counts.unack} new since you last looked` : "Speeding, zone, offline and load alerts for your fleet, and the rules that create them."}
        actions={
          <>
            {canWrite && data.counts.unack > 0 && (
              <Button variant="secondary" loading={busy} onClick={() => ack("all")}>
                <CheckCheck /> Mark all as seen
              </Button>
            )}
            {canWrite && (
              <Button onClick={() => setCreating(true)}>
                <Plus /> New alert rule
              </Button>
            )}
          </>
        }
      />

      <FilterTiles<View>
        label="Show alerts"
        value={view}
        options={tiles}
        onChange={(v) => set(v === "all" ? { status: null, kind: null, type: null } : v === "new" ? { status: "unack", kind: null, type: null } : { kind: v, status: null, type: null })}
      />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="min-w-0 overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-4">
            <SearchInput value={query.search} onChange={(v) => set({ search: v })} placeholder="Search vehicle or alert…" label="Search alerts" className="sm:w-64" />
            <div className="flex items-center gap-2">
              <Input type="date" aria-label="From date" className="w-[150px]" value={query.from ?? ""} max={query.to} onChange={(e) => set({ from: e.target.value || null, tz: null })} />
              <span className="text-xs text-muted-foreground">to</span>
              <Input type="date" aria-label="To date" className="w-[150px]" value={query.to ?? ""} min={query.from} onChange={(e) => set({ to: e.target.value || null, tz: null })} />
            </div>
            {filtered && (
              <Button variant="ghost" size="sm" onClick={clearAll}>
                Clear filters
              </Button>
            )}
            {incoming > 0 && (
              <Button
                size="sm"
                className="sm:ml-auto"
                onClick={() => {
                  setIncoming(0);
                  refresh();
                }}
              >
                <RefreshCw /> {incoming} new alert{incoming === 1 ? "" : "s"}, refresh
              </Button>
            )}
          </div>

          <div className={cn("transition-opacity", pending && "opacity-60")} aria-busy={pending}>
            {data.items.length === 0 ? (
              filtered ? (
                <EmptyState icon={BellOff} title="No alerts match these filters" action={<Button variant="secondary" size="sm" onClick={clearAll}>Clear filters</Button>} />
              ) : (
                <EmptyState icon={ShieldAlert} title="No alerts yet" description={rules.length ? "Alerts appear here as soon as a rule fires." : "Create a rule (for example a speed limit or a zone) to get alerted."} />
              )
            ) : (
              groups.map((g) => (
                <section key={g.key} aria-label={g.label} className="px-3 pb-2 pt-3 sm:px-4">
                  <h2 className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</h2>
                  <ul className="m-0 grid list-none gap-2 p-0">
                    {g.items.map((e) => (
                      <AlertRow key={e.id} e={e} title={describeAlert(e, u)} timeLabel={g.label === "Today" ? <RelativeTime iso={e.occurredAt} /> : <span suppressHydrationWarning>{time.time(e.occurredAt)}</span>} canMap={canMap} canWrite={canWrite} busy={busy} onOpen={() => setDetail(e)} onAck={() => ack([e.id])} />
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>
          {data.total > 0 && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={(p) => set({ page: p })} onPageSizeChange={(n) => set({ pageSize: n, page: null })} />}
        </Card>

        <RulesPanel compact rules={rules} geofences={geofences} vehicles={vehicles} canWrite={canWrite} onChanged={refresh} creating={creating} onCreatingChange={setCreating} />
      </div>

      <Sheet open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        {detail && (
          <SheetContent title={describeAlert(detail, u)} description={`${TYPE_LABEL[detail.type] ?? detail.type} · ${detail.ruleName}`}>
            <div className="p-5">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="m-0">{detail.acknowledgedAt ? `Acknowledged ${time.full(detail.acknowledgedAt)}` : "New"}</dd>
              <dt className="text-muted-foreground">Severity</dt>
              <dd className="m-0">
                <StatusBadge tone={sevOf(detail.type).tone} label={sevOf(detail.type).label} />
              </dd>
              <dt className="text-muted-foreground">Vehicle</dt>
              <dd className="m-0">{detail.vehicleName ?? "—"}</dd>
              <dt className="text-muted-foreground">Time</dt>
              <dd className="m-0">{time.full(detail.occurredAt)}</dd>
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
                    <MapPinned /> {typeof detail.details?.loadId === "string" ? "Open load" : "Show track on map"}
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

/** One alert as a tinted card: severity edge, icon, category + New chips, what happened, when, and actions. */
function AlertRow({ e, title, timeLabel, canMap, canWrite, busy, onOpen, onAck }: { e: AlertEventDto; title: string; timeLabel: React.ReactNode; canMap: boolean; canWrite: boolean; busy: boolean; onOpen: () => void; onAck: () => void }) {
  const color = SEVERITY_COLOR[sevOf(e.type).tone];
  const kind = kindOf(e.type);
  const kindTile = kind ? KIND_TILE[kind] : null;
  const href = canMap ? alertMapHref(e) : null;
  const unread = !e.acknowledgedAt;
  return (
    <li
      className={cn("group relative flex items-center gap-3 overflow-hidden rounded-xl border py-2.5 pl-4 pr-2.5 shadow-card transition-shadow hover:shadow-pop", unread ? "" : "opacity-90")}
      style={{ borderColor: `color-mix(in srgb, ${color} ${unread ? 35 : 18}%, var(--color-border))`, backgroundImage: `linear-gradient(110deg, var(--color-background) 40%, ${tint(color, unread ? 14 : 7)} 100%)` }}
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1" style={{ background: color }} />
      <AlertTile type={e.type} color={color} />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left text-foreground" aria-label={`Open alert: ${title}`}>
        <span className="flex flex-wrap items-center gap-1.5">
          {kindTile && (
            <span className="inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold" style={{ color: kindTile.color, background: `color-mix(in srgb, ${kindTile.color} 12%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${kindTile.color} 30%, transparent)` }}>
              {TYPE_LABEL[e.type] ?? kindTile.label}
            </span>
          )}
          {unread && <span className="inline-flex h-5 items-center rounded-full bg-danger px-2 text-[11px] font-semibold text-white">New</span>}
        </span>
        <span className={cn("mt-1 block text-sm leading-snug", unread ? "font-semibold" : "font-medium")}>{title}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          <span className="sm:hidden">{timeLabel} · </span>
          {sevOf(e.type).label} · {e.ruleName}
        </span>
      </button>
      <span className="hidden shrink-0 whitespace-nowrap text-xs text-muted-foreground sm:block">{timeLabel}</span>
      <div className="flex shrink-0 items-center gap-1">
        {href && (
          <Button asChild variant="secondary" size="icon-sm" className="border-0 bg-primary-soft text-primary hover:bg-primary-soft/70">
            <Link href={href} aria-label={typeof e.details?.loadId === "string" ? "Open load" : "Show on map"} title={typeof e.details?.loadId === "string" ? "Open load" : "Show on map"}>
              <MapPinned />
            </Link>
          </Button>
        )}
        {canWrite && unread && (
          <Button variant="secondary" size="icon-sm" className="border-0 bg-success-soft text-success hover:bg-success-soft/70" disabled={busy} onClick={onAck} aria-label="Mark as seen" title="Mark as seen">
            <Check />
          </Button>
        )}
      </div>
    </li>
  );
}
