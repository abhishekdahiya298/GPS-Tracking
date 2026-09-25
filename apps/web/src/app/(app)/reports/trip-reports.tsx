"use client";
/**
 * Trip reports. The calculation is unchanged (server: /api/reports/trips, the
 * same trip detection as before); this is presentation only. One report covers
 * one vehicle for up to the server's maximum range, so the trips are sorted
 * and paged in the browser without extra requests.
 */
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarRange, Download, Mail, MapPinned, Route, Truck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { SegmentedFilter } from "@/components/app/filter-bar";
import { PageHeader } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/app/states";
import { useUnits } from "@/components/app/units-context";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { TripDto, TripReport } from "@/lib/reports";

type Dev = { id: string; label: string };
type Preset = "7d" | "yesterday" | "today" | "30d" | "custom";
type SortKey = "start" | "duration" | "distance" | "max";
const PAGE = 25;

const day = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

function presetRange(p: Exclude<Preset, "custom">): [string, string] {
  const now = new Date();
  const back = (n: number) => day(new Date(now.getTime() - n * 86_400_000));
  switch (p) {
    case "today":
      return [day(now), day(now)];
    case "yesterday":
      return [back(1), back(1)];
    case "30d":
      return [back(29), day(now)];
    default:
      return [back(6), day(now)];
  }
}

export function TripReports({ devices, canSchedule = false }: { devices: Dev[]; canSchedule?: boolean }) {
  const u = useUnits();
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const [deviceId, setDeviceId] = useState(devices[0]?.id ?? "");
  const [preset, setPreset] = useState<Preset>("7d");
  const [[fromDay, toDay], setDays] = useState<[string, string]>(() => presetRange("7d"));
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
    const from = new Date(`${fromDay}T00:00:00`);
    const to = new Date(`${toDay}T00:00:00`);
    to.setDate(to.getDate() + 1);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [fromDay, toDay]);
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

  useEffect(() => {
    if (ready) void load();
    // First load only; later loads are explicit ("Show trips").
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const trips = useMemo(() => {
    const list = [...(report?.trips ?? [])];
    const val = (t: TripDto) => (sort.key === "start" ? Date.parse(t.startAt) : sort.key === "duration" ? t.durationMin : sort.key === "distance" ? t.distanceKm : t.maxSpeedKph);
    list.sort((a, b) => (val(a) - val(b)) * (sort.dir === "asc" ? 1 : -1));
    return list;
  }, [report, sort]);
  const shown = trips.slice((page - 1) * PAGE, page * PAGE);

  const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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

  return (
    <>
      <PageHeader
        title="Trip reports"
        description="Trips, distance, driving time and top speed for a vehicle over a period."
        actions={
          canSchedule && (
            <Button asChild variant="secondary">
              <Link href="/reports/schedules">
                <Mail /> Email schedules
              </Link>
            </Button>
          )
        }
      />

      <Card className="mb-4">
        <form
          method="post"
          className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void load();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <label className="grid gap-1.5 text-sm font-medium">
              Vehicle
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
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={busy} disabled={!deviceId}>
              <Route /> Show trips
            </Button>
            {report && report.trips.length > 0 && (
              <Button asChild variant="secondary">
                <a href={`/api/reports/trips?${qs}&format=csv`} download>
                  <Download /> CSV
                </a>
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 md:col-span-2">
            <SegmentedFilter<Preset>
              label="Quick range"
              value={preset}
              onChange={(p) => {
                setPreset(p);
                if (p !== "custom") setDays(presetRange(p));
              }}
              options={[
                { value: "today", label: "Today" },
                { value: "yesterday", label: "Yesterday" },
                { value: "7d", label: "Last 7 days" },
                { value: "30d", label: "Last 30 days" },
                { value: "custom", label: "Custom" }
              ]}
            />
            <span className="text-xs text-muted-foreground">Times in {tz}. A trip ends after 5 minutes parked or a 20-minute gap in data.</span>
          </div>
        </form>
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
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-[84px]" />
            ))}
          </div>
          <Card>
            <TableSkeleton rows={6} cols={5} />
          </Card>
        </div>
      ) : (
        <div className={busy ? "pointer-events-none opacity-60 transition-opacity" : "transition-opacity"} aria-busy={busy}>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {(
              [
                ["Trips", String(report.totals.trips)],
                ["Distance", u.fmtDist(report.totals.distanceKm)],
                ["Driving time", hm(report.totals.drivingMin)],
                ["Top speed", u.fmtSpeed(report.totals.maxSpeedKph)]
              ] as const
            ).map(([k, v]) => (
              <Card key={k} className="p-4">
                <div className="text-xs font-medium text-muted-foreground">{k}</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{v}</div>
              </Card>
            ))}
          </div>

          {report.trips.length === 0 ? (
            <Card>
              <EmptyState icon={CalendarRange} title="No trips in this period" description={`${vehicleLabel} didn't drive between ${fromDay} and ${toDay}. Try a longer range.`} />
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <Card className="h-fit">
                <CardHeader>
                  <CardTitle>By day</CardTitle>
                </CardHeader>
                <Table>
                  <THead>
                    <TR>
                      <TH>Day</TH>
                      <TH className="text-right">Trips</TH>
                      <TH className="text-right">Distance</TH>
                      <TH className="text-right">Driving</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {report.days.map((d) => (
                      <TR key={d.day}>
                        <TD className="whitespace-nowrap">{new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</TD>
                        <TD className="text-right tabular-nums">{d.trips}</TD>
                        <TD className="whitespace-nowrap text-right tabular-nums">{u.fmtDist(d.distanceKm)}</TD>
                        <TD className="whitespace-nowrap text-right tabular-nums">{hm(d.drivingMin)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Trips</CardTitle>
                </CardHeader>
                <div className="hidden sm:block">
                  <Table>
                    <THead>
                      <TR>
                        {sortHead("start", "Start")}
                        {sortHead("duration", "Duration", "text-right")}
                        {sortHead("distance", "Distance", "text-right")}
                        {sortHead("max", "Max", "text-right")}
                        <TH className="text-right">Avg</TH>
                        <TH>
                          <span className="sr-only">Map</span>
                        </TH>
                      </TR>
                    </THead>
                    <TBody>
                      {shown.map((t) => (
                        <TR key={t.startAt}>
                          <TD className="whitespace-nowrap">
                            {fmt(t.startAt)}
                            <div className="text-xs text-muted-foreground">to {fmt(t.endAt)}</div>
                          </TD>
                          <TD className="whitespace-nowrap text-right tabular-nums">{hm(t.durationMin)}</TD>
                          <TD className="whitespace-nowrap text-right tabular-nums">{u.fmtDist(t.distanceKm)}</TD>
                          <TD className="whitespace-nowrap text-right tabular-nums">{u.fmtSpeed(t.maxSpeedKph)}</TD>
                          <TD className="whitespace-nowrap text-right tabular-nums">{u.fmtSpeed(t.avgMovingKph)}</TD>
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
            </div>
          )}
        </div>
      )}
    </>
  );
}

function MapLink({ report, t }: { report: TripReport; t: TripDto }) {
  return (
    <Button asChild variant="ghost" size="sm">
      <Link
        href={`/map?${new URLSearchParams({ device: report.deviceId, from: t.startAt, to: new Date(Date.parse(t.endAt) + 60_000).toISOString() })}`}
        aria-label={`View the trip starting ${new Date(t.startAt).toLocaleString()} on the map`}
      >
        <MapPinned /> Map
      </Link>
    </Button>
  );
}
