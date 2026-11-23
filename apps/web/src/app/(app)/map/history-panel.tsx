"use client";
/**
 * Trip history and replay for one vehicle: the last 24 hours by default, summary tiles,
 * one-shot replay of the whole window on a coloured timeline (driving / idling / stopped),
 * and a list of every trip and stop. Server limits are kept: points are fetched in pages of
 * 5,000 up to MAX_HISTORY_POINTS; nothing is invented or altered.
 */
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import maplibregl from "maplibre-gl";
import { CalendarDays, ChevronLeft, ChevronRight, CircleStop, Clock, Gauge, History, Lock, Pause, Pencil, Play, Route, Timer, X } from "lucide-react";
import { usePlan } from "@/components/app/plan/plan-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, toWallTime, wallTimeToUtc } from "@rio-gps/core/timezones";
import { DateRangeCalendar, daySpan, shortDay, type DayRange } from "@/components/app/date-range-calendar";
import { useTime } from "@/components/app/time-context";
import { useUnits } from "@/components/app/units-context";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { LocationPoint } from "@/lib/locations";
import { placeText, useAddressState } from "@/lib/use-address";
import { cn } from "@/lib/cn";
import { indexAtTime, quickRange, timeline, trackStats, type TimelineEvent } from "./fleet-model";

export const MAX_HISTORY_POINTS = 20_000;
type Range = "24h" | "today" | "yesterday" | "7d" | "day" | "custom";
const SPEEDS = [10, 60, 300] as const;
const KIND = {
  trip: { color: "#16a34a", label: "Driving", icon: Route },
  idle: { color: "#ea580c", label: "Idling", icon: Timer },
  stop: { color: "#dc2626", label: "Stopped", icon: CircleStop }
} as const;

function hm(ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m} min`;
}

/** One row of the timeline: start time, coloured dot on the line, what happened and where. */
function EventRow({ e, last, active, onPick }: { e: TimelineEvent; last: boolean; active: boolean; onPick: () => void }) {
  const u = useUnits();
  const t = useTime();
  const a = useAddressState(e.lat, e.lon, false);
  const k = KIND[e.kind];
  const Icon = k.icon;
  const title = e.kind === "trip" ? `Trip ${e.n}` : e.kind === "idle" ? "Idling" : e.endMs - e.startMs >= 4 * 3_600_000 ? "Parked" : "Stopped";
  const place = placeText(a, e.lat, e.lon);
  return (
    <li className={cn("grid grid-cols-[60px_24px_minmax(0,1fr)] gap-2 rounded-xl px-1", active && "bg-primary-soft shadow-[inset_0_0_0_1.5px_var(--color-primary)]")}>
      <span className="pt-2 text-right text-[11.5px] leading-tight tabular-nums text-muted-foreground">
        {t.time(new Date(e.startMs).toISOString())}
        <span className="block text-[10px]">{t.date(new Date(e.startMs).toISOString()).replace(/, \d{4}$/, "")}</span>
      </span>
      <span className="flex flex-col items-center">
        <span className="mt-1.5 grid size-6 shrink-0 place-items-center rounded-full text-white" style={{ background: k.color }}>
          <Icon className="size-3" aria-hidden="true" />
        </span>
        {!last && <span className="w-0.5 flex-1 bg-border" />}
      </span>
      <button type="button" onClick={onPick} className="min-w-0 cursor-pointer border-0 bg-transparent py-1.5 pr-1 text-left">
        <span className="flex items-baseline justify-between gap-2">
          <b className="truncate text-[13px] text-foreground">{title}</b>
          <span className="shrink-0 text-xs font-bold" style={{ color: k.color }}>
            {hm(e.endMs - e.startMs)}
          </span>
        </span>
        <span className="block truncate text-xs text-foreground/75" title={a.address?.label ?? place}>
          {e.kind === "trip" ? `to ${place}` : place}
        </span>
        <span className="block text-[11px] tabular-nums text-muted-foreground">
          until {t.time(new Date(e.endMs).toISOString())}
          {e.kind === "trip" && ` · ${u.fmtDist(e.distanceM / 1000, 0)} · max ${u.fmtSpeed(e.maxSpeedKph)}`}
        </span>
      </button>
    </li>
  );
}

export function HistoryPanel({
  map,
  deviceId,
  deviceName,
  initial,
  onClose
}: {
  map: MlMap | null;
  deviceId: string;
  deviceName: string;
  /** Deep link (from reports, vehicle pages): load this window immediately. */
  initial?: { from: string; to: string } | null;
  onClose: () => void;
}) {
  const u = useUnits();
  const t = useTime();
  const tz = t.timeZone;
  // datetime-local inputs hold wall-clock time in the viewer's effective zone (not the device's).
  const localInput = (d: Date) => toWallTime(d, tz);
  const [range, setRange] = useState<Range>(initial ? "custom" : "24h");
  const [from, setFrom] = useState(() => localInput(initial ? new Date(initial.from) : quickRange("24h", tz).from));
  const [to, setTo] = useState(() => (initial ? localInput(new Date(initial.to)) : ""));
  const [track, setTrack] = useState<LocationPoint[]>([]);
  const [window_, setWindow] = useState<{ start: number; end: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(60);
  const times = useMemo(() => track.map((p) => Date.parse(p.recordedAt)), [track]);
  const stats = useMemo(() => trackStats(track), [track]);
  const events = useMemo(() => timeline(track), [track]);
  const totals = useMemo(() => {
    const sum = (k: TimelineEvent["kind"]) => events.filter((e) => e.kind === k).reduce((a, e) => a + (e.endMs - e.startMs), 0);
    // Idling counts engine-on time standing still, inside trips too (the same rule as reports).
    const idle = events.reduce((a, e) => a + e.idleS * 1000, 0);
    return { driving: sum("trip") - events.filter((e) => e.kind === "trip").reduce((a, e) => a + e.idleS * 1000, 0), idle, stopped: sum("stop"), trips: events.filter((e) => e.kind === "trip").length };
  }, [events]);

  // The parent removes the map before this panel's cleanup runs (React unmounts parents
  // first), so every map call is gated on the map still existing.
  const alive = useRef(false);
  useEffect(() => {
    if (!map) return;
    alive.current = true;
    const onRemove = () => {
      alive.current = false;
    };
    map.on("remove", onRemove);
    return () => {
      map.off("remove", onRemove);
    };
  }, [map]);
  const source = useCallback((id: string) => (map && alive.current ? (map.getSource(id) as GeoJSONSource | undefined) : undefined), [map]);

  const draw = useCallback(
    (pts: LocationPoint[], evs: TimelineEvent[]) => {
      source("track")?.setData({
        type: "FeatureCollection",
        features: pts.length > 1 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pts.map((p) => [p.longitude, p.latitude]) } }] : []
      });
      source("track-done")?.setData({ type: "FeatureCollection", features: [] });
      source("track-stops")?.setData({
        type: "FeatureCollection",
        features: evs.filter((e) => e.kind !== "trip").map((e) => ({ type: "Feature", properties: { color: KIND[e.kind].color }, geometry: { type: "Point", coordinates: [e.lon, e.lat] } }))
      });
      if (map && alive.current && pts.length > 0) {
        const b = new maplibregl.LngLatBounds();
        pts.forEach((p) => b.extend([p.longitude, p.latitude]));
        map.fitBounds(b, { padding: 60, maxZoom: 16, duration: 600 });
      }
    },
    [map, source]
  );

  const drawCursor = useCallback(
    (p: LocationPoint | undefined) => {
      source("track-pos")?.setData({
        type: "FeatureCollection",
        features: p ? [{ type: "Feature", properties: { heading: p.headingDeg ?? 0 }, geometry: { type: "Point", coordinates: [p.longitude, p.latitude] } }] : []
      });
    },
    [source]
  );

  // The driven part of the track, redrawn at most 4 times a second during replay.
  const doneAt = useRef(0);
  const drawDone = useCallback(
    (i: number, force = false) => {
      const nowMs = performance.now();
      if (!force && nowMs - doneAt.current < 250) return;
      doneAt.current = nowMs;
      source("track-done")?.setData({
        type: "FeatureCollection",
        features: i > 0 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: track.slice(0, i + 1).map((p) => [p.longitude, p.latitude]) } }] : []
      });
    },
    [source, track]
  );

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    setPlaying(false);
    try {
      const fromUtc = wallTimeToUtc(from, tz);
      const toUtc = to ? wallTimeToUtc(to, tz) : new Date();
      const pts: LocationPoint[] = [];
      let next: string | null = null;
      do {
        const qs = new URLSearchParams({ deviceId, from: fromUtc.toISOString(), limit: "5000" });
        if (to) qs.set("to", toUtc.toISOString());
        if (next) qs.set("cursor", next);
        const r = await fetch(`/api/locations/history?${qs}`, { cache: "no-store" });
        if (r.status === 401) {
          window.location.assign("/login?next=/map");
          return;
        }
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error?.message ?? `Request failed (${r.status})`);
        pts.push(...body.points);
        next = body.nextCursor;
        setLimitedFrom(body.limitedFrom ?? null);
      } while (next && pts.length < MAX_HISTORY_POINTS);
      setTrack(pts);
      setWindow({ start: fromUtc.getTime(), end: toUtc.getTime() });
      setCursor(0);
      draw(pts, timeline(pts));
      drawCursor(pts[0]);
      if (!pts.length) setError("No GPS points in this time range.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load history");
    } finally {
      setBusy(false);
    }
  }, [deviceId, from, to, tz, draw, drawCursor]);

  const clear = useCallback(() => {
    setPlaying(false);
    setTrack([]);
    draw([], []);
    drawCursor(undefined);
  }, [draw, drawCursor]);

  // Clear the drawn track when the panel closes or the vehicle changes.
  useEffect(() => clear, [deviceId, clear]);

  // Opening (and every quick range): load right away, no extra click.
  const [loadKey, setLoadKey] = useState(0);
  useEffect(() => {
    if (map) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, loadKey]);

  // Playback clock: advances recorded time at `speed`× real time; skips the parked hours
  // between points so the whole window plays in one go.
  useEffect(() => {
    if (!playing || times.length < 2) return;
    let raf = 0;
    let last = performance.now();
    let sim = times[cursor] ?? times[0]!;
    const tick = (now: number) => {
      sim += (now - last) * speed;
      last = now;
      let i = indexAtTime(times, sim);
      // A long gap (parked) is jumped over rather than waited through.
      const nextT = times[i + 1];
      if (nextT !== undefined && nextT - sim > 10 * 60_000 * (speed / 60)) {
        sim = nextT;
        i += 1;
      }
      setCursor(i);
      if (i >= times.length - 1) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed, times]);

  useEffect(() => {
    if (!track.length) return;
    drawCursor(track[cursor]);
    drawDone(cursor, !playing);
  }, [cursor, track, drawCursor, drawDone, playing]);

  const [editing, setEditing] = useState(false);
  const [limitedFrom, setLimitedFrom] = useState<string | null>(null);
  const { plan, requestUpgrade } = usePlan();
  const todayKey = toWallTime(new Date(), tz).slice(0, 10);
  const pickRange = (r: Range) => {
    if (r === "custom") {
      setRange("custom");
      setEditing(true);
      return;
    }
    setEditing(false);
    setRange(r);
    const q = quickRange(r as "24h" | "today" | "yesterday" | "7d", tz);
    setFrom(localInput(q.from));
    setTo(q.to ? localInput(q.to) : "");
    setLoadKey((k) => k + 1);
  };
  /** One whole day (today runs until now). */
  const showDay = (day: string) => {
    if (day >= todayKey) return pickRange("today");
    if (day === addDays(todayKey, -1)) return pickRange("yesterday");
    setEditing(false);
    setRange("day");
    setFrom(`${day}T00:00`);
    setTo(`${addDays(day, 1)}T00:00`);
    setLoadKey((k) => k + 1);
  };
  const applyCustom = (r: DayRange) => {
    setEditing(false);
    setRange("custom");
    setFrom(`${r.startDay}T${r.startTime}`);
    const end = `${r.endDay}T${r.endTime === "23:59" ? "23:59" : r.endTime}`;
    // An end at or after now means "until now" (keeps following new points).
    setTo(wallTimeToUtc(end, tz).getTime() >= Date.now() ? "" : end);
    setLoadKey((k) => k + 1);
  };
  const shownDay = from.slice(0, 10);
  const steppable = range === "today" || range === "yesterday" || range === "day";
  const rangeTitle =
    range === "24h" ? "Last 24 hours" : range === "7d" ? "Last 7 days" : range === "today" ? `Today, ${shortDay(todayKey)}` : range === "yesterday" ? `Yesterday, ${shortDay(shownDay)}` : range === "day" ? t.day(shownDay) : window_ ? `${t.dateTime(new Date(window_.start).toISOString())} → ${to ? t.dateTime(new Date(window_.end).toISOString()) : "now"}` : "";
  const rangeSub =
    range === "yesterday" || range === "day"
      ? "Full day"
      : range === "today"
        ? `${t.time(wallTimeToUtc(from, tz).toISOString())} → now`
        : range === "custom"
          ? (() => {
              const n = daySpan(from.slice(0, 10), (to || toWallTime(new Date(), tz)).slice(0, 10));
              return `${n} day${n === 1 ? "" : "s"}${to ? "" : " · until now"}`;
            })()
          : window_
            ? `${t.dateTime(new Date(window_.start).toISOString())} → now`
            : "";
  const calendarValue: DayRange = {
    startDay: from.slice(0, 10),
    endDay: (to || toWallTime(new Date(), tz)).slice(0, 10),
    startTime: range === "custom" ? from.slice(11, 16) : "00:00",
    endTime: range === "custom" && to ? to.slice(11, 16) : "23:59"
  };

  const p = track[cursor];
  const span = window_ ? Math.max(1, window_.end - window_.start) : 1;
  const pct = (ms: number) => (window_ ? Math.min(100, Math.max(0, ((ms - window_.start) / span) * 100)) : 0);
  const ticks = window_ ? [0.25, 0.5, 0.75].map((f) => window_.start + f * span) : [];
  const activeEvent = events.findIndex((e) => cursor >= e.from && cursor <= e.to);

  return (
    <section aria-label={`Trip history for ${deviceName}`} className="flex flex-col gap-3 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="m-0 flex items-center gap-1.5 text-sm font-bold text-primary">
            <History className="size-4" aria-hidden="true" /> Trip history
          </h2>
          <p className="m-0 truncate text-[13px] text-muted-foreground">{deviceName}</p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close trip history" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div role="radiogroup" aria-label="Time range" className="grid grid-cols-5 gap-0.5 rounded-lg bg-muted p-0.5">
        {(
          [
            ["24h", "24 h"],
            ["today", "Today"],
            ["yesterday", "Yesterday"],
            ["7d", "7 days"],
            ["custom", "Custom"]
          ] as [Range, string][]
        ).map(([v, l]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={range === v}
            onClick={() => pickRange(v)}
            className={cn("h-7 cursor-pointer rounded-md border-0 px-0.5 text-xs font-semibold", range === v ? "bg-background text-primary shadow-card" : "bg-transparent text-muted-foreground hover:text-foreground")}
          >
            {l}
          </button>
        ))}
      </div>

      {editing ? (
        <DateRangeCalendar
          key={`${from}|${to}`}
          value={calendarValue}
          today={todayKey}
          busy={busy}
          onApply={applyCustom}
          onCancel={range === "custom" && window_ ? () => setEditing(false) : () => pickRange("24h")}
        />
      ) : (
        <div className="flex items-center gap-2 rounded-xl bg-muted/60 p-1.5 shadow-[inset_0_0_0_1px_var(--color-border)]">
          {steppable ? (
            <Button variant="secondary" size="icon-sm" className="bg-background" aria-label="Previous day" onClick={() => showDay(addDays(range === "today" ? todayKey : shownDay, -1))}>
              <ChevronLeft />
            </Button>
          ) : (
            <Button variant="secondary" size="icon-sm" className="bg-background" aria-label="Pick dates" onClick={() => pickRange("custom")}>
              <CalendarDays />
            </Button>
          )}
          <div className="min-w-0 flex-1 text-center">
            <div className="text-[13.5px] font-bold leading-tight tabular-nums text-foreground">{rangeTitle}</div>
            <div className="truncate text-[11.5px] tabular-nums text-muted-foreground">
              {rangeSub}
              {rangeSub ? " · " : ""}times in {t.abbr()}
            </div>
          </div>
          {steppable ? (
            <Button variant="secondary" size="icon-sm" className="bg-background" aria-label="Next day" disabled={range === "today"} onClick={() => showDay(addDays(shownDay, 1))}>
              <ChevronRight />
            </Button>
          ) : range === "custom" ? (
            <Button variant="secondary" size="sm" className="bg-background text-primary" onClick={() => setEditing(true)}>
              <Pencil /> Change
            </Button>
          ) : (
            <span className="w-8" />
          )}
        </div>
      )}
      {limitedFrom && (
        <div className="flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          <Lock className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="flex-1">
            {plan?.planName ?? "Your plan"} shows {plan?.limits.historyDays && plan.limits.historyDays > 1 ? `the last ${plan.limits.historyDays} days` : "today only"}. Earlier trips come with a paid plan.
          </span>
          <button type="button" className="cursor-pointer border-0 bg-transparent p-0 font-bold text-primary" onClick={() => requestUpgrade(["trip_history"])}>
            Upgrade
          </button>
        </div>
      )}

      {error && <Alert tone="warning">{error}</Alert>}

      {busy && !track.length ? (
        <div className="grid gap-2" aria-busy="true" aria-label="Loading trips">
          <Skeleton className="h-24" />
          <Skeleton className="h-16" />
        </div>
      ) : (
        track.length > 1 && (
          <>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  ["Distance", u.fmtDist(stats.km, 0), Route, "#1d4ed8"],
                  ["Driving", hm(totals.driving), Clock, "#16a34a"],
                  ["Idling", hm(totals.idle), Timer, "#ea580c"],
                  ["Stopped", hm(totals.stopped), CircleStop, "#dc2626"],
                  ["Trips", String(totals.trips), History, "#6d28d9"],
                  ["Top speed", u.fmtSpeed(stats.maxKph), Gauge, "#b91c1c"]
                ] as const
              ).map(([l, v, Icon, c]) => (
                <div key={l} className="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5" style={{ background: `linear-gradient(120deg, var(--color-background) 40%, color-mix(in srgb, ${c} 13%, var(--color-background)))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${c} 24%, transparent)` }}>
                  <span className="grid size-6 shrink-0 place-items-center rounded-md text-white" style={{ background: c }}>
                    <Icon className="size-3" aria-hidden="true" />
                  </span>
                  <span className="grid min-w-0 leading-tight">
                    <b className="truncate text-[13px] tabular-nums">{v}</b>
                    <span className="text-[10.5px] text-muted-foreground">{l}</span>
                  </span>
                </div>
              ))}
            </div>

            {/* Player: one row, the whole window on a coloured bar. */}
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1 rounded-xl border border-border bg-background px-2.5 pb-2 pt-7 shadow-card">
              <button
                type="button"
                aria-label={playing ? "Pause replay" : "Play the whole window"}
                onClick={() => {
                  if (!playing && cursor >= track.length - 1) setCursor(0);
                  setPlaying((v) => !v);
                }}
                className="row-span-2 grid size-10 cursor-pointer place-items-center rounded-full border-0 bg-gradient-to-br from-[#1849c6] to-[#0a2463] text-white shadow-[0_6px_14px_-6px_#0a2463]"
              >
                {playing ? <Pause className="size-4" aria-hidden="true" /> : <Play className="ml-0.5 size-4" aria-hidden="true" />}
              </button>
              <div className="relative h-3">
                <div className="absolute inset-0 overflow-hidden rounded-full bg-muted">
                  {events.map((e, i) => (
                    <i key={i} className="absolute inset-y-0" style={{ left: `${pct(e.startMs)}%`, width: `${Math.max(0.4, pct(e.endMs) - pct(e.startMs))}%`, background: KIND[e.kind].color, opacity: e.kind === "stop" ? 0.55 : 0.95 }} />
                  ))}
                </div>
                {p && (
                  <span className="pointer-events-none absolute top-1/2 z-[1] -translate-x-1/2 -translate-y-1/2" style={{ left: `${pct(Date.parse(p.recordedAt))}%` }}>
                    <span className="block size-4 rounded-full border-[3px] border-primary bg-background shadow" />
                    <span className="absolute bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-primary px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-primary-foreground">
                      {t.time(p.recordedAt)} · {u.fmtSpeed(p.speedKph)}
                    </span>
                  </span>
                )}
                <input
                  type="range"
                  className="absolute inset-0 z-[2] h-full w-full cursor-pointer opacity-0"
                  min={0}
                  max={track.length - 1}
                  value={cursor}
                  onChange={(e) => {
                    setPlaying(false);
                    setCursor(Number(e.target.value));
                  }}
                  aria-label="Replay position"
                  aria-valuetext={p ? `${t.dateTimeSec(p.recordedAt)}, ${u.fmtSpeed(p.speedKph)}` : undefined}
                />
              </div>
              <div className="relative h-3.5 text-[10px] text-muted-foreground">
                {ticks.map((ms, i) => (
                  <span key={i} className="absolute -translate-x-1/2 whitespace-nowrap tabular-nums" style={{ left: `${pct(ms)}%` }}>
                    {t.time(new Date(ms).toISOString())}
                  </span>
                ))}
                <span className="absolute right-0 font-bold text-foreground">{to ? t.time(new Date(window_!.end).toISOString()) : "Now"}</span>
              </div>
              <div className="col-span-2 mt-1 flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {u.fmtDist(stats.cumKm[cursor] ?? 0, 0)} of {u.fmtDist(stats.km, 0)}
                </span>
                <div role="radiogroup" aria-label="Replay speed" className="ml-auto flex gap-0.5 rounded-md bg-muted p-0.5">
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={speed === s}
                      onClick={() => setSpeed(s)}
                      className={cn("h-6 cursor-pointer rounded border-0 px-2 text-[11px] font-bold", speed === s ? "bg-background text-primary shadow-card" : "bg-transparent text-muted-foreground")}
                    >
                      {s}×
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Trips and stops */}
            <section aria-labelledby="trip-list">
              <h3 id="trip-list" className="m-0 mb-1 flex items-center justify-between text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Trips and stops
                <span className="font-semibold normal-case tracking-normal">
                  {totals.trips} trip{totals.trips === 1 ? "" : "s"} · {events.length - totals.trips} stop{events.length - totals.trips === 1 ? "" : "s"}
                </span>
              </h3>
              <ol className="m-0 grid list-none p-0">
                {events.map((e, i) => (
                  <EventRow
                    key={`${e.kind}-${e.startMs}`}
                    e={e}
                    last={i === events.length - 1}
                    active={i === activeEvent}
                    onPick={() => {
                      setPlaying(false);
                      setCursor(e.from);
                      if (map && alive.current) map.easeTo({ center: [e.lon, e.lat], zoom: Math.max(map.getZoom(), 12), duration: 500 });
                    }}
                  />
                ))}
              </ol>
              <p className="m-0 mt-1 text-[11px] text-muted-foreground">
                {track.length.toLocaleString("en-US")} GPS points
                {track.length >= MAX_HISTORY_POINTS ? " · limit reached, choose a shorter range to see everything" : ""}
              </p>
            </section>
          </>
        )
      )}
    </section>
  );
}
