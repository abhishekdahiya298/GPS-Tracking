"use client";
/**
 * Stops, idling, speeding and mileage reports. Everything is calculated on the server from
 * stored GPS history (/api/reports/activity) with the same trip engine as the Trip report;
 * this component only picks the parameters and presents the result.
 */
import { addDays, dateFormatter, startOfLocalDay, zoneLabel } from "@rio-gps/core/timezones";
import { CalendarRange, Download, Gauge, MapPinned, Search, Truck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SegmentedFilter } from "@/components/app/filter-bar";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { Pagination } from "@/components/app/pagination";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/app/states";
import { useTime } from "@/components/app/time-context";
import { useUnits } from "@/components/app/units-context";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { ActivityReport, ActivityReportType, IdleRow, MileageRow, SpeedRow, StopRow } from "@/lib/activity-reports";
import { ReportTabs } from "./report-tabs";

type Dev = { id: string; label: string };
type Preset = "7d" | "yesterday" | "today" | "30d" | "custom";
const PAGE = 25;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const hm = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`);
const secs = (s: number) => (s < 60 ? `${s} s` : hm(Math.round(s / 60)));

const META: Record<ActivityReportType, { title: string; description: string; noun: string; empty: string; note: string }> = {
  stops: {
    title: "Stops report",
    description: "Where and how long each vehicle was parked between trips.",
    noun: "stops",
    empty: "No stops of this length in the period.",
    note: "A stop is the time between two trips. A vehicle that is parked now shows as still stopped."
  },
  idling: {
    title: "Idling report",
    description: "Time spent with the engine on while standing still.",
    noun: "idle periods",
    empty: "No idling of this length in the period.",
    note: "Idling needs the tracker's ignition signal: engine on and speed near zero."
  },
  speeding: {
    title: "Speeding report",
    description: "Every stretch driven above the speed you choose.",
    noun: "speeding events",
    empty: "No driving above this speed in the period.",
    note: "Based on the speeds the tracker reported; it does not know the posted road limit."
  },
  mileage: {
    title: "Mileage report",
    description: "Distance and driving time per vehicle, by day and by month.",
    noun: "days",
    empty: "No driving in the period.",
    note: "Distance is measured along trips, the same way as the Trip report."
  }
};

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

export function ActivityReports({ type, devices, groups = [] }: { type: ActivityReportType; devices: Dev[]; groups?: { id: string; name: string }[] }) {
  const u = useUnits();
  const time = useTime();
  const tz = time.timeZone;
  const meta = META[type];
  const [deviceId, setDeviceId] = useState("all");
  const [preset, setPreset] = useState<Preset>("7d");
  const [[fromDay, toDay], setDays] = useState<[string, string]>(() => presetRange("7d", tz));
  const [minMinutes, setMinMinutes] = useState(type === "idling" ? 5 : 10);
  // The limit is typed in the organization's units and sent in km/h.
  const [limit, setLimit] = useState(u.system === "imperial" ? 70 : 110);
  const [report, setReport] = useState<ActivityReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [ready, setReady] = useState(false);

  // Shareable state: ?device=&from=&to=&min=&limit= (local calendar days). Applied once.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const dv = q.get("device");
    const f = q.get("from");
    const t = q.get("to");
    const m = Number(q.get("min"));
    const l = Number(q.get("limit"));
    if (dv && (dv === "all" || devices.some((d) => d.id === dv) || groups.some((g) => `group:${g.id}` === dv))) setDeviceId(dv);
    if (f && t && DAY_RE.test(f) && DAY_RE.test(t)) {
      setPreset("custom");
      setDays([f, t]);
    }
    if (Number.isInteger(m) && m >= 1 && m <= 1440) setMinMinutes(m);
    if (Number.isFinite(l) && l >= 10 && l <= 200) setLimit(l);
    setReady(true);
  }, [devices, groups]);

  const limitOk = Number.isFinite(limit) && limit >= 10 && u.toKph(limit) <= 250;
  const qs = useMemo(() => {
    // The vehicle picker also lists groups ("group:<id>"): all vehicles, narrowed to the group.
    const groupId = deviceId.startsWith("group:") ? deviceId.slice(6) : null;
    const p = new URLSearchParams({
      type,
      deviceId: groupId ? "all" : deviceId,
      ...(groupId ? { groupId } : {}),
      // Midnight to midnight in the report's zone (23 or 25 hours on clock-change days).
      from: startOfLocalDay(fromDay, tz).toISOString(),
      to: startOfLocalDay(addDays(toDay, 1), tz).toISOString(),
      tz
    });
    if (type === "stops" || type === "idling") p.set("minMinutes", String(minMinutes));
    if (type === "speeding") p.set("limitKph", String(Math.round(u.toKph(limit) * 10) / 10));
    return p.toString();
  }, [type, deviceId, fromDay, toDay, tz, minMinutes, limit, u]);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    const url = new URLSearchParams({ device: deviceId, from: fromDay, to: toDay });
    if (type === "stops" || type === "idling") url.set("min", String(minMinutes));
    if (type === "speeding") url.set("limit", String(limit));
    window.history.replaceState(null, "", `?${url}`);
    try {
      const res = await fetch(`/api/reports/activity?${qs}`, { cache: "no-store" });
      if (res.status === 401) {
        window.location.assign(`/login?next=/reports/${type}`);
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
  }, [qs, type, deviceId, fromDay, toDay, minMinutes, limit]);

  useEffect(() => {
    if (ready) void load();
    // First load only; later loads are explicit ("Show report").
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const many = (deviceId === "all" || deviceId.startsWith("group:")) && devices.length > 1;
  const rows = report?.rows ?? [];
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);

  if (devices.length === 0) {
    return (
      <>
        <PageHeader title={meta.title} description={meta.description} />
        <ReportTabs active={type} />
        <Card>
          <EmptyState
            icon={Truck}
            title="No vehicles to report on yet"
            description="Add a vehicle and assign a GPS device. Reports fill in once it has driven."
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

  const stats: [string, string][] = !report
    ? []
    : type === "stops"
      ? [
          ["Stops", String(report.totals.count)],
          ["Total stopped", hm(report.totals.durationMin)],
          ["Longest stop", hm(Math.max(0, ...(rows as StopRow[]).map((r) => r.durationMin)))],
          ["Vehicles", `${report.byVehicle.length} of ${report.vehicles}`]
        ]
      : type === "idling"
        ? [
            ["Idle periods", String(report.totals.count)],
            ["Total idling", hm(report.totals.durationMin)],
            ["Longest", hm(Math.max(0, ...(rows as IdleRow[]).map((r) => r.durationMin)))],
            ["Vehicles", `${report.byVehicle.length} of ${report.vehicles}`]
          ]
        : type === "speeding"
          ? [
              ["Events", String(report.totals.count)],
              ["Top speed", report.totals.count ? u.fmtSpeed(report.totals.maxSpeedKph) : "—"],
              ["Time over limit", hm(report.totals.durationMin)],
              ["Vehicles", `${report.byVehicle.length} of ${report.vehicles}`]
            ]
          : [
              ["Distance", u.fmtDist(report.totals.distanceKm)],
              ["Driving time", hm(report.totals.durationMin)],
              ["Trips", String(report.totals.count)],
              ["Vehicles driven", `${report.byVehicle.length} of ${report.vehicles}`]
            ];

  return (
    <>
      <PageHeader title={meta.title} description={meta.description} />
      <ReportTabs active={type} />

      <Card className="mb-4">
        <form
          method="post"
          className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (type !== "speeding" || limitOk) void load();
          }}
        >
          <div className={`grid gap-3 ${type === "mileage" ? "sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]" : "sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]"}`}>
            <label className="grid gap-1.5 text-sm font-medium">
              Vehicle
              <Select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                <option value="all">All vehicles</option>
                {groups.length > 0 && (
                  <optgroup label="Groups">
                    {groups.map((g) => (
                      <option key={g.id} value={`group:${g.id}`}>
                        {g.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Vehicles">
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </optgroup>
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
            {(type === "stops" || type === "idling") && (
              <label className="grid gap-1.5 text-sm font-medium">
                {type === "stops" ? "Stops longer than" : "Idling longer than"}
                <Select value={String(minMinutes)} onChange={(e) => setMinMinutes(Number(e.target.value))}>
                  {[...new Set([2, 5, 10, 15, 30, 60, 120, 240, minMinutes])]
                    .sort((a, b) => a - b)
                    .map((m) => (
                      <option key={m} value={m}>
                        {hm(m)}
                      </option>
                    ))}
                </Select>
              </label>
            )}
            {type === "speeding" && (
              <label className="grid gap-1.5 text-sm font-medium">
                Faster than ({u.speed})
                <Input
                  type="number"
                  inputMode="numeric"
                  min={10}
                  max={u.system === "imperial" ? 155 : 250}
                  step={1}
                  required
                  value={Number.isFinite(limit) ? limit : ""}
                  aria-invalid={!limitOk}
                  onChange={(e) => setLimit(e.target.value === "" ? NaN : Number(e.target.value))}
                />
              </label>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={busy} disabled={type === "speeding" && !limitOk}>
              <Search /> Show report
            </Button>
            {report && rows.length > 0 && (
              <Button asChild variant="secondary">
                <a href={`/api/reports/activity?${qs}&format=csv`} download>
                  <Download /> CSV
                </a>
              </Button>
            )}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-3 md:col-span-2">
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
            <span className="text-xs text-muted-foreground">
              Times in {time.abbr()} ({zoneLabel(tz)}). {meta.note}
            </span>
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
            {stats.map(([k, v]) => (
              <StatCard key={k} label={k} value={v} />
            ))}
          </div>

          {report.truncated && (
            <Alert tone="warning" className="mb-4">
              Showing the first {rows.length.toLocaleString("en-US")} rows. The totals above cover everything; choose a shorter period or one vehicle to see every row.
            </Alert>
          )}

          {rows.length === 0 ? (
            <Card>
              <EmptyState icon={type === "speeding" ? Gauge : CalendarRange} title={meta.empty} description={`Checked ${report.vehicles} ${report.vehicles === 1 ? "vehicle" : "vehicles"} from ${time.day(fromDay)} to ${time.day(toDay)}.`} />
            </Card>
          ) : (
            <div className={`grid grid-cols-1 gap-4 ${many || type === "mileage" ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]" : ""}`}>
              {(many || type === "mileage") && (
                <div className="grid h-fit gap-4">
                  {many && (
                    <Card>
                      <CardHeader>
                        <CardTitle>By vehicle</CardTitle>
                      </CardHeader>
                      <Table>
                        <THead>
                          <TR>
                            <TH>Vehicle</TH>
                            {type === "mileage" ? (
                              <>
                                <TH className="text-right">Distance</TH>
                                <TH className="text-right">Driving</TH>
                              </>
                            ) : (
                              <>
                                <TH className="text-right">{type === "speeding" ? "Events" : "Count"}</TH>
                                <TH className="text-right">{type === "speeding" ? "Top speed" : "Total time"}</TH>
                              </>
                            )}
                          </TR>
                        </THead>
                        <TBody>
                          {report.byVehicle.slice(0, 50).map((v) => (
                            <TR key={v.deviceId}>
                              <TD className="max-w-[14rem] truncate">{v.vehicle}</TD>
                              {type === "mileage" ? (
                                <>
                                  <TD className="whitespace-nowrap text-right tabular-nums">{u.fmtDist(v.distanceKm)}</TD>
                                  <TD className="whitespace-nowrap text-right tabular-nums">{hm(v.durationMin)}</TD>
                                </>
                              ) : (
                                <>
                                  <TD className="text-right tabular-nums">{v.count}</TD>
                                  <TD className="whitespace-nowrap text-right tabular-nums">{type === "speeding" ? u.fmtSpeed(v.maxSpeedKph) : hm(v.durationMin)}</TD>
                                </>
                              )}
                            </TR>
                          ))}
                        </TBody>
                      </Table>
                      {report.byVehicle.length > 50 && <p className="m-0 border-t border-border px-4 py-2 text-xs text-muted-foreground">Top 50 of {report.byVehicle.length} vehicles. The CSV has every row.</p>}
                    </Card>
                  )}
                  {type === "mileage" && (
                    <Card>
                      <CardHeader>
                        <CardTitle>By month</CardTitle>
                      </CardHeader>
                      <Table>
                        <THead>
                          <TR>
                            <TH>Month</TH>
                            {many && <TH>Vehicle</TH>}
                            <TH className="text-right">Distance</TH>
                            <TH className="text-right">Trips</TH>
                          </TR>
                        </THead>
                        <TBody>
                          {report.months.slice(0, 100).map((m) => (
                            <TR key={`${m.month}${m.deviceId}`}>
                              <TD className="whitespace-nowrap">{time.month(m.month)}</TD>
                              {many && <TD className="max-w-[12rem] truncate">{m.vehicle}</TD>}
                              <TD className="whitespace-nowrap text-right tabular-nums">{u.fmtDist(m.distanceKm)}</TD>
                              <TD className="text-right tabular-nums">{m.trips}</TD>
                            </TR>
                          ))}
                        </TBody>
                      </Table>
                    </Card>
                  )}
                </div>
              )}

              <Card>
                <CardHeader>
                  <CardTitle>{type === "mileage" ? "By day" : type === "stops" ? "Stops" : type === "idling" ? "Idle periods" : "Speeding events"}</CardTitle>
                </CardHeader>
                <div className="hidden sm:block">
                  <Table>
                    <THead>
                      <TR>
                        {type === "mileage" ? (
                          <>
                            <TH>Day</TH>
                            {many && <TH>Vehicle</TH>}
                            <TH className="text-right">Distance</TH>
                            <TH className="text-right">Driving</TH>
                            <TH className="text-right">Idling</TH>
                            <TH className="text-right">Trips</TH>
                          </>
                        ) : (
                          <>
                            <TH>{type === "speeding" ? "When" : "From"}</TH>
                            {many && <TH>Vehicle</TH>}
                            <TH className="text-right">Duration</TH>
                            {type === "speeding" && <TH className="text-right">Top speed</TH>}
                            <TH>
                              <span className="sr-only">Map</span>
                            </TH>
                          </>
                        )}
                      </TR>
                    </THead>
                    <TBody>
                      {type === "mileage"
                        ? (shown as MileageRow[]).map((r) => (
                            <TR key={`${r.day}${r.deviceId}`}>
                              <TD className="whitespace-nowrap">{time.day(r.day)}</TD>
                              {many && <TD className="max-w-[14rem] truncate">{r.vehicle}</TD>}
                              <TD className="whitespace-nowrap text-right tabular-nums">{u.fmtDist(r.distanceKm)}</TD>
                              <TD className="whitespace-nowrap text-right tabular-nums">{hm(r.drivingMin)}</TD>
                              <TD className="whitespace-nowrap text-right tabular-nums">{hm(r.idleMin)}</TD>
                              <TD className="text-right tabular-nums">{r.trips}</TD>
                            </TR>
                          ))
                        : (shown as (StopRow | IdleRow | SpeedRow)[]).map((r) => (
                            <TR key={`${r.startAt}${r.deviceId}`}>
                              <TD className="whitespace-nowrap">
                                {time.dateTime(r.startAt)}
                                <div className="text-xs text-muted-foreground">{r.endAt ? (r.endAt === r.startAt ? "single reading" : `to ${time.dateTime(r.endAt)}`) : "still stopped"}</div>
                              </TD>
                              {many && <TD className="max-w-[14rem] truncate">{r.vehicle}</TD>}
                              <TD className="whitespace-nowrap text-right tabular-nums">{"durationS" in r ? secs(r.durationS) : hm(r.durationMin)}</TD>
                              {"maxSpeedKph" in r && (
                                <TD className="whitespace-nowrap text-right tabular-nums">
                                  {u.fmtSpeed(r.maxSpeedKph)}
                                  <div className="text-xs text-muted-foreground">+{u.fmtSpeed(r.overKph)}</div>
                                </TD>
                              )}
                              <TD className="text-right">
                                <MapLink row={r} />
                              </TD>
                            </TR>
                          ))}
                    </TBody>
                  </Table>
                </div>
                <ul className="m-0 list-none divide-y divide-border p-0 sm:hidden">
                  {type === "mileage"
                    ? (shown as MileageRow[]).map((r) => (
                        <li key={`${r.day}${r.deviceId}`} className="px-4 py-3 text-sm">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="font-medium">{time.day(r.day)}</span>
                            <span className="tabular-nums">{u.fmtDist(r.distanceKm)}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {many ? `${r.vehicle} · ` : ""}
                            {hm(r.drivingMin)} driving · {r.trips} {r.trips === 1 ? "trip" : "trips"}
                          </div>
                        </li>
                      ))
                    : (shown as (StopRow | IdleRow | SpeedRow)[]).map((r) => (
                        <li key={`${r.startAt}${r.deviceId}`} className="flex items-center justify-between gap-3 px-4 py-3">
                          <div className="min-w-0 text-sm">
                            <div className="font-medium">{time.dateTime(r.startAt)}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {many ? `${r.vehicle} · ` : ""}
                              {"durationS" in r ? `${secs(r.durationS)} · top ${u.fmtSpeed(r.maxSpeedKph)}` : `${hm(r.durationMin)}${r.endAt ? "" : " · still stopped"}`}
                            </div>
                          </div>
                          <MapLink row={r} />
                        </li>
                      ))}
                </ul>
                {rows.length > PAGE && <Pagination page={page} pageSize={PAGE} total={rows.length} onPageChange={setPage} />}
              </Card>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** Opens the live map's history for the vehicle around the event (5 minutes either side). */
function MapLink({ row }: { row: StopRow | IdleRow | SpeedRow }) {
  const time = useTime();
  const from = new Date(Date.parse(row.startAt) - 5 * 60_000).toISOString();
  const end = Date.parse(row.endAt ?? row.startAt);
  // Long stops: show the arrival and the first hour, not days of standing still.
  const to = new Date(Math.min(end, Date.parse(row.startAt) + 3_600_000) + 5 * 60_000).toISOString();
  return (
    <Button asChild variant="ghost" size="sm">
      <Link href={`/map?${new URLSearchParams({ device: row.deviceId, from, to })}`} aria-label={`View ${row.vehicle} at ${time.dateTime(row.startAt)} on the map`}>
        <MapPinned /> Map
      </Link>
    </Button>
  );
}
