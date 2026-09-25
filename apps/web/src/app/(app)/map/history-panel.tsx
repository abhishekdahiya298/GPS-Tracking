"use client";
/**
 * Track history + playback for one vehicle. Server limits are kept: points are
 * fetched in pages of 5,000 up to MAX_HISTORY_POINTS; nothing is invented or
 * altered. Playback moves a marker through the recorded fixes in time order.
 */
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import maplibregl from "maplibre-gl";
import { Pause, Play, Route, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUnits } from "@/components/app/units-context";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import type { LocationPoint } from "@/lib/locations";
import { cn } from "@/lib/cn";
import { indexAtTime, quickRange, trackStats } from "./fleet-model";

export const MAX_HISTORY_POINTS = 20_000;
type Range = "today" | "yesterday" | "7d" | "custom";
const SPEEDS = [1, 10, 60, 300] as const;

function localInput(d: Date) {
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
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
  /** Deep link (from trip reports): load this window immediately. */
  initial?: { from: string; to: string } | null;
  onClose: () => void;
}) {
  const u = useUnits();
  const [range, setRange] = useState<Range>(initial ? "custom" : "today");
  const [from, setFrom] = useState(() => localInput(initial ? new Date(initial.from) : quickRange("today").from));
  const [to, setTo] = useState(() => (initial ? localInput(new Date(initial.to)) : ""));
  const [track, setTrack] = useState<LocationPoint[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(60);
  const times = useMemo(() => track.map((p) => Date.parse(p.recordedAt)), [track]);
  const stats = useMemo(() => trackStats(track), [track]);
  const loadedFor = useRef<string | null>(null);

  const draw = useCallback(
    (pts: LocationPoint[]) => {
      const src = map?.getSource("track") as GeoJSONSource | undefined;
      src?.setData({
        type: "FeatureCollection",
        features: pts.length > 1 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pts.map((p) => [p.longitude, p.latitude]) } }] : []
      });
      if (map && pts.length > 0) {
        const b = new maplibregl.LngLatBounds();
        pts.forEach((p) => b.extend([p.longitude, p.latitude]));
        map.fitBounds(b, { padding: 60, maxZoom: 16, duration: 600 });
      }
    },
    [map]
  );

  const drawCursor = useCallback(
    (p: LocationPoint | undefined) => {
      const src = map?.getSource("track-pos") as GeoJSONSource | undefined;
      src?.setData({
        type: "FeatureCollection",
        features: p ? [{ type: "Feature", properties: { heading: p.headingDeg ?? 0 }, geometry: { type: "Point", coordinates: [p.longitude, p.latitude] } }] : []
      });
    },
    [map]
  );

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    setPlaying(false);
    try {
      const pts: LocationPoint[] = [];
      let next: string | null = null;
      do {
        const qs = new URLSearchParams({ deviceId, from: new Date(from).toISOString(), limit: "5000" });
        if (to) qs.set("to", new Date(to).toISOString());
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
      } while (next && pts.length < MAX_HISTORY_POINTS);
      setTrack(pts);
      setCursor(0);
      draw(pts);
      drawCursor(pts[0]);
      loadedFor.current = deviceId;
      if (!pts.length) setError("No GPS points in this time range.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load history");
    } finally {
      setBusy(false);
    }
  }, [deviceId, from, to, draw, drawCursor]);

  const clear = useCallback(() => {
    setPlaying(false);
    setTrack([]);
    draw([]);
    drawCursor(undefined);
  }, [draw, drawCursor]);

  // Clear the drawn track when the panel closes or the vehicle changes.
  useEffect(() => clear, [deviceId, clear]);

  // Deep link: load once.
  useEffect(() => {
    if (initial && map) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // Playback clock: advances recorded time at `speed`× real time.
  useEffect(() => {
    if (!playing || times.length < 2) return;
    let raf = 0;
    let last = performance.now();
    let sim = times[cursor] ?? times[0]!;
    const tick = (t: number) => {
      sim += (t - last) * speed;
      last = t;
      const i = indexAtTime(times, sim);
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
    if (track.length) drawCursor(track[cursor]);
  }, [cursor, track, drawCursor]);

  const pickRange = (r: Range) => {
    setRange(r);
    if (r === "custom") return;
    const q = quickRange(r);
    setFrom(localInput(q.from));
    setTo(q.to ? localInput(q.to) : "");
  };

  const p = track[cursor];
  const dt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });

  return (
    <section aria-label={`History for ${deviceName}`} className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">History</h2>
          <p className="text-[13px] text-muted-foreground">{deviceName}</p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close history" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div role="radiogroup" aria-label="Time range" className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1">
        {(
          [
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
            className={cn(
              "h-7 cursor-pointer rounded-md border-0 text-[13px] font-medium",
              range === v ? "bg-background text-foreground shadow-card" : "bg-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {l}
          </button>
        ))}
      </div>

      {range === "custom" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            From
            <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            To (empty = now)
            <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      )}

      <div className="flex gap-2">
        <Button className="flex-1" onClick={load} loading={busy}>
          <Route /> Show track
        </Button>
        {track.length > 0 && (
          <Button variant="secondary" onClick={clear}>
            Clear
          </Button>
        )}
      </div>

      {error && <Alert tone="warning">{error}</Alert>}

      {track.length > 1 && (
        <div className="grid gap-3 rounded-lg border border-border p-3">
          <div className="flex items-center gap-2">
            <Button size="icon-sm" variant="secondary" aria-label={playing ? "Pause" : "Play"} onClick={() => {
              if (!playing && cursor >= track.length - 1) setCursor(0);
              setPlaying((v) => !v);
            }}>
              {playing ? <Pause /> : <Play />}
            </Button>
            <input
              type="range"
              className="h-2 flex-1 cursor-pointer accent-[var(--color-primary)]"
              min={0}
              max={track.length - 1}
              value={cursor}
              onChange={(e) => {
                setPlaying(false);
                setCursor(Number(e.target.value));
              }}
              aria-label="Playback position"
              aria-valuetext={p ? dt.format(new Date(p.recordedAt)) : undefined}
            />
            <Select aria-label="Playback speed" className="h-8 w-[74px] text-[13px]" value={speed} onChange={(e) => setSpeed(Number(e.target.value) as (typeof SPEEDS)[number])}>
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </Select>
          </div>
          {p && (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[13px]">
              <dt className="text-muted-foreground">Time</dt>
              <dd className="m-0 text-right tabular-nums">{dt.format(new Date(p.recordedAt))}</dd>
              <dt className="text-muted-foreground">Speed</dt>
              <dd className="m-0 text-right tabular-nums">{u.fmtSpeed(p.speedKph)}</dd>
              <dt className="text-muted-foreground">Distance</dt>
              <dd className="m-0 text-right tabular-nums">
                {u.fmtDist(stats.cumKm[cursor] ?? 0)} / {u.fmtDist(stats.km)}
              </dd>
              <dt className="text-muted-foreground">Max speed</dt>
              <dd className="m-0 text-right tabular-nums">{u.fmtSpeed(stats.maxKph)}</dd>
            </dl>
          )}
          <p className="m-0 text-xs text-muted-foreground">
            {track.length.toLocaleString()} GPS points
            {track.length >= MAX_HISTORY_POINTS ? " · limit reached, choose a shorter range to see everything" : ""}
          </p>
        </div>
      )}
    </section>
  );
}
