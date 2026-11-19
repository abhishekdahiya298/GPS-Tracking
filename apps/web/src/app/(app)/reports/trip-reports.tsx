"use client";
/**
 * Trip reports. The calculation is unchanged (server: /api/reports/trips, the
 * same trip detection as before); this is presentation only. One report covers
 * one vehicle for up to the server's maximum range, so the trips are sorted
 * and paged in the browser without extra requests.
 */
import { addDays, dateFormatter, startOfLocalDay, zoneLabel } from "@rio-gps/core/timezones";
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarRange, Clock, Download, Gauge, Mail, MapPinned, Milestone, Route, Timer, Truck } from "lucide-react";
import { ColumnChart } from "@/components/app/charts";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { SegmentedFilter } from "@/components/app/filter-bar";
import { PageHeader } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/app/states";
import { useTime } from "@/components/app/time-context";
import { useUnits } from "@/components/app/units-context";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { TripDto, TripReport } from "@/lib/reports";
import { ReportTabs } from "./report-tabs";

type Dev = { id: string; label: string };
type Preset = "7d" | "yesterday" | "today" | "30d" | "custom";
type SortKey = "start" | "duration" | "distance" | "max";
const PAGE = 25;

const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

/** Local calendar days in `tz` (the viewer's effective zone), not the device's clock. */
function presetRange(p: Exclude<Preset, "custom">, tz: string): [string, string] {
  const today = dateFormatter(tz).dayKey(Date.now());
  switch (p) {
    case "today":
      return [today, today];
    case "yesterday":
      return [addDays(today, -1), addDays(today, -1)];
    case "30d":
      return [addDays(today, -29), today];
    default:
      return [addDays(today, -6), today];
  }
}

export function TripReports({ devices, canSchedule = false }: { devices: Dev[]; canSchedule?: boolean }) {
  const u = useUnits();
  const time = useTime();
  const tz = time.timeZone;
  const [deviceId, setDeviceId] = useState(devices[0]?.id ?? "");
  const [preset, setPreset] = useState<Preset>("7d");
  const [[fromDay, toDay], setDays] = useState<[string, string]>(() => presetRange("7d", tz));
  const [report, setReport] = useState<TripReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "start", dir: "desc" });
  const [page, setPage] = useState(1);
  const [ready, setReady] = useState(false);

  // Shareable state: ?device=&from=&to= (local calendar days). Applied once, then the first load runs.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const dv = q.get("device");
    const f = q.get("from");
    const t = q.get("to");
    if (dv && devices.some((d) => d.id === dv)) setDeviceId(dv);
    if (f && t && /^\d{4}-\d{2}-\d{2}$/.test(f) && /^\d{4}-\d{2}-\d{2}$/.test(t)) {
      setPreset("custom");
      setDays([f, t]);
    }
    setReady(true);
  }, [devices]);

  const range = useMemo(() => {
    // Midnight to midnight in the report's zone (23 or 25 hours on DST change days).
    return { from: startOfLocalDay(fromDay, tz).toISOString(), to: startOfLocalDay(addDays(toDay, 1), tz).toISOString() };
  }, [fromDay, toDay, tz]);
  const qs = useMemo(() => new URLSearchParams({ deviceId, from: range.from, to: range.to, tz }).toString(), [deviceId, range, tz]);

  const load = useCallback(async () => {
    if (!deviceId) return;
    setBusy(true);
    setError(null);
    window.history.replaceState(null, "", `?${new URLSearchParams({ device: deviceId, from: fromDay, to: toDay })}`);
    try {
      const res = await fetch(`/api/reports/trips?${qs}`, { cache: "no-store" });
      if (res.status === 401) {
        window.location.assign("/login?next=/reports");
        return;
      }
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      setReport(body);
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the report");
      setReport(null);
    } finally {
      setBusy(false);
    }
  }, [deviceId, qs, fromDay, toDay]);

  // Loads as soon as the vehicle or dates change: no extra "Show" click.
  useEffect(() => {
    if (ready) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, qs]);

  const trips = useMemo(() => {
    const list = [...(report?.trips ?? [])];
    const val = (t: TripDto) => (sort.key === "start" ? Date.parse(t.startAt) : sort.key === "duration" ? t.durationMin : sort.key === "distance" ? t.distanceKm : t.maxSpeedKph);
    list.sort((a, b) => (val(a) - val(b)) * (sort.dir === "asc" ? 1 : -1));
    return list;
  }, [report, sort]);
  const shown = trips.slice((page - 1) * PAGE, page * PAGE);

  const fmt = time.dateTime;
  const vehicleLabel = devices.find((d) => d.id === deviceId)?.label ?? "";

  const sortHead = (k: SortKey, label: string, className?: string): ReactNode => {
    const active = sort.key === k;
    const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <TH aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={className}>
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 font-medium uppercase text-inherit"
          onClick={() => {
            setSort((s) => ({ key: k, dir: s.key === k && s.dir === "desc" ? "asc" : "desc" }));
            setPage(1);
          }}
        >
          {label}
          <Icon className="size-3.5" aria-hidden="true" />
        </button>
      </TH>
    );
  };

  if (devices.length === 0) {
    return (
      <>
        <PageHeader title="Trip reports" description="Trips, distance and driving time for each vehicle." />
        <Card>
          <EmptyState
            icon={Truck}
            title="No vehicles to report on yet"
            description="Add a vehicle and assign a GPS device. Trips appear here once it has driven."
            action={
              <Button asChild size="sm">
                <Link href="/vehicles">Go to vehicles</Link>
              </Button>
            }
          />
        </Card>
      </>
    );
  }

  const totalIdle = report ? report.trips.reduce((a, t) => a + t.idleMin, 0) : 0;
  const drivingMin = report?.totals.drivingMin ?? 0;
  const dayPoints = (report?.days ?? []).map((d) => ({ key: d.day, label: time.day(d.day).replace(/^\w+, /, ""), longLabel: time.day(d.day), value: u.dist(d.distanceKm), valueLabel: u.fmtDist(d.distanceKm) }));
  const speedPoints = (report?.days ?? []).map((d) => ({ key: d.day, label: time.day(d.day).replace(/^\w+, /, ""), longLabel: time.day(d.day), value: Math.round(u.speed === "mph" ? d.maxSpeedKph / 1.609344 : d.maxSpeedKph), valueLabel: u.fmtSpeed(d.maxSpeedKph) }));
  const avgMoving = report && report.trips.length ? report.trips.reduce((a, t) => a + t.avgMovingKph * t.drivingMin, 0) / Math.max(1, report.trips.reduce((a, t) => a + t.drivingMin, 0)) : 0;

  return (
    <>
      <PageHeader
        title="Reports"
        description="Trips, stops, driving time, speed and mileage for your fleet."
        actions={
          <>
            {canSchedule && (
              <Button asChild variant="secondary">
                <Link href="/reports/schedules">
                  <Mail /> Email schedules
                </Link>
              </Button>
            )}
            {report && report.trips.length > 0 && (
              <Button asChild>
                <a href={`/api/reports/trips?${qs}&format=csv`} download>
                  <Download /> Export
                </a>
              </Button>
            )}
          </>
        }
      />

      <ReportTabs active="trips" />

      <Card className="mb-4">
        <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_auto] lg:items-end">
          <label className="grid gap-1.5 text-sm font-medium">
            <span className="inline-flex items-center gap-1.5">
              <Truck className="size-4 text-[#15803d]" aria-hidden="true" /> Vehicle
            </span>
            <Select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            From
            <Input
              type="date"
              value={fromDay}
              max={toDay}
              onChange={(e) => {
                setPreset("custom");
                setDays([e.target.value, toDay]);
              }}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            To
            <Input
              type="date"
              value={toDay}
              min={fromDay}
              onChange={(e) => {
                setPreset("custom");
                setDays([fromDay, e.target.value]);
              }}
            />
          </label>
          <SegmentedFilter<Preset>
            label="Quick range"
            value={preset}
            onChange={(p) => {
              setPreset(p);
              if (p !== "custom") setDays(presetRange(p, tz));
            }}
            options={[
              { value: "today", label: "Today" },
              { value: "yesterday", label: "Yesterday" },
              { value: "7d", label: "Last 7 days" },
              { value: "30d", label: "Last 30 days" },
              { value: "custom", label: "Custom" }
            ]}
          />
        </div>
        <p className="m-0 border-t border-border px-4 py-2 text-xs text-muted-foreground">
          Times in {time.abbr()} ({zoneLabel(tz)}). A trip ends after 5 minutes parked or a 20-minute gap in data. The report updates as you change the vehicle or dates.
        </p>
      </Card>

      {error ? (
        <Card>
          <ErrorState
            title="Unable to load the report"
            description={error}
            action={
              <Button variant="secondary" onClick={load}>
                Try again
              </Button>
            }
          />
        </Card>
      ) : !report ? (
        <div className="grid gap-4" aria-busy="true" aria-label="Loading report">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-[76px]" />
            ))}
          </div>
          <Card>
            <TableSkeleton rows={6} cols={6} />
          </Card>
        </div>
      ) : (
        <div className={busy ? "pointer-events-none opacity-60 transition-opacity" : "transition-opacity"} aria-busy={busy}>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Kpi icon={Route} color="#1d4ed8" label="Trips" value={String(report.totals.trips)} />
            <Kpi icon={Milestone} color="#6d28d9" label="Total distance" value={u.fmtDist(report.totals.distanceKm)} />
            <Kpi icon={Clock} color="#15803d" label="Driving time" value={hm(report.totals.drivingMin)} />
            <Kpi icon={Gauge} color="#b91c1c" label="Top speed" value={u.fmtSpeed(report.totals.maxSpeedKph)} />
            <Kpi icon={Timer} color="#c2410c" label="Total idling" value={hm(totalIdle)} />
          </div>

          {report.trips.length === 0 ? (
            <Card>
              <EmptyState icon={CalendarRange} title="No trips in this period" description={`${vehicleLabel} didn't drive between ${fromDay} and ${toDay}. Try a longer range.`} />
            </Card>
          ) : (
            <>
              <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Card className="min-w-0">
                  <CardHeader>
                    <CardTitle className="text-sm">Distance per day</CardTitle>
                  </CardHeader>
                  <div className="px-4 pb-4">
                    <ColumnChart data={dayPoints} ariaLabel="Distance per day" tableHeads={["Day", "Distance"]} color="#6d28d9" labelEvery={dayPoints.length > 10 ? 5 : 1} className="h-44" />
                  </div>
                </Card>
                <Card className="min-w-0">
                  <CardHeader>
                    <CardTitle className="text-sm">Driving time</CardTitle>
                  </CardHeader>
                  <DriveDonut driving={drivingMin} idle={totalIdle} />
                </Card>
                <Card className="min-w-0">
                  <CardHeader>
                    <CardTitle className="text-sm">Top speed per day</CardTitle>
                    <span className="text-xs text-muted-foreground">
                      Avg moving <strong className="text-foreground">{u.fmtSpeed(avgMoving)}</strong>
                    </span>
                  </CardHeader>
                  <div className="px-4 pb-4">
                    <ColumnChart data={speedPoints} ariaLabel="Top speed per day" tableHeads={["Day", "Top speed"]} color="#dc2626" labelEvery={speedPoints.length > 10 ? 5 : 1} className="h-44" />
                  </div>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>
                    Trip details <span className="text-sm font-normal text-muted-foreground">({trips.length} trip{trips.length === 1 ? "" : "s"})</span>
                  </CardTitle>
                </CardHeader>
                <div className="hidden overflow-x-auto sm:block">
                  <Table>
                    <THead>
                      <TR>
                        <TH className="w-10">#</TH>
                        {sortHead("start", "Start")}
                        <TH>End</TH>
                        {sortHead("duration", "Duration", "text-right")}
                        {sortHead("distance", "Distance", "text-right")}
                        {sortHead("max", "Max speed", "text-right")}
                        <TH className="text-right" title="Average speed while moving (stops with the engine running are left out)">Avg speed</TH>
                        <TH className="text-right">Idle</TH>
                        <TH className="text-right">Actions</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {shown.map((t, i) => (
                        <TR key={t.startAt}>
                          <TD className="tabular-nums text-muted-foreground">{(page - 1) * PAGE + i + 1}</TD>
                          <TD className="whitespace-nowrap">{fmt(t.startAt)}</TD>
                          <TD className="whitespace-nowrap">{fmt(t.endAt)}</TD>
                          <TD className="whitespace-nowrap text-right tabular-nums">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="size-3.5 text-[#15803d]" aria-hidden="true" />
                              {hm(t.durationMin)}
                            </span>
                          </TD>
                          <TD className="whitespace-nowrap text-right font-medium tabular-nums">{u.fmtDist(t.distanceKm)}</TD>
                          <TD className="whitespace-nowrap text-right tabular-nums">{u.fmtSpeed(t.maxSpeedKph)}</TD>
                          <TD className="whitespace-nowrap text-right tabular-nums">{u.fmtSpeed(t.avgMovingKph)}</TD>
                          <TD className="whitespace-nowrap text-right tabular-nums">
                            <span className="inline-flex items-center gap-1">
                              <Timer className="size-3.5 text-[#c2410c]" aria-hidden="true" />
                              {t.idleMin < 1 ? "—" : `${t.idleMin}m`}
                            </span>
                          </TD>
                          <TD className="text-right">
                            <MapLink report={report} t={t} />
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
                <ul className="m-0 list-none divide-y divide-border p-0 sm:hidden">
                  {shown.map((t) => (
                    <li key={t.startAt} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0 text-sm">
                        <div className="font-medium">{fmt(t.startAt)}</div>
                        <div className="text-xs text-muted-foreground">
                          {hm(t.durationMin)} · {u.fmtDist(t.distanceKm)} · max {u.fmtSpeed(t.maxSpeedKph)}
                        </div>
                      </div>
                      <MapLink report={report} t={t} />
                    </li>
                  ))}
                </ul>
                {trips.length > PAGE && <Pagination page={page} pageSize={PAGE} total={trips.length} onPageChange={setPage} />}
              </Card>
            </>
          )}
        </div>
      )}
    </>
  );
}

/** Coloured KPI card: tinted icon, value, label. */
function Kpi({ icon: Icon, color, label, value }: { icon: typeof Route; color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border p-3.5 shadow-card" style={{ borderColor: `color-mix(in srgb, ${color} 22%, var(--color-border))`, backgroundImage: `linear-gradient(135deg, var(--color-background) 45%, color-mix(in srgb, ${color} 12%, var(--color-background)))` }}>
      <span className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}>
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xl font-bold tabular-nums">{value}</span>
        <span className="block truncate text-xs font-medium text-muted-foreground">{label}</span>
      </span>
    </div>
  );
}

/** Driving vs idling, as a ring with the total in the middle and a labelled legend. */
function DriveDonut({ driving, idle }: { driving: number; idle: number }) {
  const total = driving + idle;
  const R = 40;
  const C = 2 * Math.PI * R;
  const d = total ? (driving / total) * C : 0;
  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0);
  return (
    <div className="flex flex-wrap items-center gap-5 px-5 pb-5">
      <svg viewBox="0 0 100 100" className="size-36 shrink-0 -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={R} fill="none" stroke="#cbd5e1" strokeWidth="12" />
        <circle cx="50" cy="50" r={R} fill="none" stroke="#16a34a" strokeWidth="12" strokeDasharray={`${d} ${C}`} strokeLinecap={d > 0 && d < C ? "round" : "butt"} />
        <text x="50" y="47" transform="rotate(90 50 50)" textAnchor="middle" dominantBaseline="central" className="fill-foreground text-[11px] font-bold tabular-nums">
          {hm(total)}
        </text>
        <text x="50" y="62" transform="rotate(90 50 50)" textAnchor="middle" className="fill-muted-foreground text-[7px]" style={{ letterSpacing: 0 }}>
          total
        </text>
      </svg>
      <ul className="m-0 grid min-w-36 flex-1 list-none gap-2 p-0 text-sm">
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="size-2.5 rounded-full bg-[#16a34a]" />
          <span className="flex-1 text-muted-foreground">Driving</span>
          <strong className="tabular-nums">{hm(driving)}</strong>
          <span className="w-10 text-right text-xs text-muted-foreground">{pct(driving)}%</span>
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="size-2.5 rounded-full bg-[#cbd5e1]" />
          <span className="flex-1 text-muted-foreground">Idle / stop</span>
          <strong className="tabular-nums">{hm(idle)}</strong>
          <span className="w-10 text-right text-xs text-muted-foreground">{pct(idle)}%</span>
        </li>
      </ul>
    </div>
  );
}

function MapLink({ report, t }: { report: TripReport; t: TripDto }) {
  const time = useTime();
  return (
    <Button asChild variant="ghost" size="sm" className="bg-[#1d4ed8]/10 text-[#1d4ed8] hover:bg-[#1d4ed8]/15 dark:text-[#93b4ff]">
      <Link
        href={`/map?${new URLSearchParams({ device: report.deviceId, from: t.startAt, to: new Date(Date.parse(t.endAt) + 60_000).toISOString() })}`}
        aria-label={`View the trip starting ${time.dateTime(t.startAt)} on the map`}
      >
        <MapPinned /> Map
      </Link>
    </Button>
  );
}
