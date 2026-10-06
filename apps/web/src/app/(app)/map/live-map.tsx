"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibregl, { type Map as MlMap, type Popup } from "maplibre-gl";
import { ChevronUp, CircleDotDashed, Copy, Download, Crosshair, ExternalLink, History, Hexagon, LocateFixed, Maximize2, PanelLeftClose, PanelLeftOpen, Radio, Share2, Tag, Truck, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shapeRing } from "@rio-gps/core/geo";
import { SearchInput } from "@/components/app/search-input";
import { EmptyState } from "@/components/app/states";
import { Select } from "@/components/ui/input";
import { VehicleTypeIcon } from "@/components/app/vehicle-type-icon";
import { asVehicleType, VEHICLE_TYPE_LABEL } from "@/lib/schemas/vehicle";
import { useTime } from "@/components/app/time-context";
import { useUnits } from "@/components/app/units-context";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import type { GeofenceDto } from "@/lib/alerts";
import { cn } from "@/lib/cn";
import type { CurrentDeviceLocation } from "@/lib/locations";
import { FleetLayer, STATE_COLORS, type FleetPoint } from "./fleet-layer";
import { compass, csvSafe, deviceLabel, FALLBACK_VIEW, mapState, MAP_STATES, type MapState } from "./fleet-model";
import { useFleetStream } from "./use-fleet-stream";

// Loaded on first use: most sessions never open history.
const HistoryPanel = dynamic(() => import("./history-panel").then((m) => m.HistoryPanel), { ssr: false });
const ShareDialog = dynamic(() => import("../vehicles/share-dialog").then((m) => m.ShareDialog), { ssr: false });

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const ROW_H = 64;
const STATE_LABEL: Record<MapState, string> = { moving: "Moving", idle: "Idling", stopped: "Stopped", offline: "Offline" };
const STATE_HINT: Record<MapState, string> = {
  moving: "Travelling",
  idle: "Engine on, not moving",
  stopped: "Parked, engine off",
  offline: "Tracker not reporting"
};
const ZONE_LAYERS = ["fences-fill", "fences-line", "fences-label"];
type Filter = "all" | MapState;

function ago(iso: string | null, now: number) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function toPoint(d: CurrentDeviceLocation, now: number, offlineSeconds: number): FleetPoint | null {
  if (!d.location) return null;
  return {
    id: d.deviceId,
    name: deviceLabel(d),
    state: mapState(d, now, offlineSeconds),
    type: d.vehicle ? asVehicleType(d.vehicle.type) : "other",
    lngLat: [d.location.longitude, d.location.latitude],
    heading: d.location.headingDeg
  };
}

function StateDot({ state }: { state: MapState }) {
  return <span aria-hidden="true" className="inline-block size-2 shrink-0 rounded-full" style={{ background: STATE_COLORS[state] }} />;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="m-0 truncate text-sm font-medium" title={hint}>
        {value}
      </dd>
    </div>
  );
}

export function LiveMap({
  offlineSeconds,
  groups = [],
  canShare = false
}: {
  offlineSeconds: number;
  groups?: { id: string; name: string; vehicleIds: string[] }[];
  /** Whether this user may create public share links (the server enforces it regardless). */
  canShare?: boolean;
}) {
  const u = useUnits();
  const time = useTime();
  // Read from callbacks that are set up once (stream handlers, the popup effect).
  const timeRef = useRef(time);
  timeRef.current = time;
  const mapDiv = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MlMap | null>(null);
  const layer = useRef<FleetLayer | null>(null);
  const popup = useRef<Popup | null>(null);
  const hover = useRef<Popup | null>(null);
  const fitted = useRef(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<{ device: string; from: string; to: string } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [groupId, setGroupId] = useState("");
  const [sort, setSort] = useState<"status" | "name" | "recent" | "speed">("status");
  const [clustered, setClustered] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showZones, setShowZones] = useState(true);
  const [follow, setFollow] = useState(false);
  const [sharing, setSharing] = useState(false);
  // Read inside stream callbacks that are created once.
  const followRef = useRef<string | null>(null);
  followRef.current = follow ? selected : null;

  const mapRef = useRef<MlMap | null>(null);

  const { devices, conn, version, loaded } = useFleetStream({
    onSnapshot: (list) => {
      const pts = list.map((d) => toPoint(d, Date.now(), offlineSeconds)).filter((p): p is FleetPoint => p !== null);
      layer.current?.reset(pts);
      fitFleet(false);
    },
    onUpdate: (list) => {
      const pts = list.map((d) => toPoint(d, Date.now(), offlineSeconds)).filter((p): p is FleetPoint => p !== null);
      layer.current?.upsert(pts);
      // Follow mode: keep the selected vehicle in view as it moves.
      const f = followRef.current;
      const hit = f ? pts.find((p) => p.id === f) : undefined;
      if (hit) mapRef.current?.easeTo({ center: hit.lngLat, duration: 900 });
    },
    onAlert: (a) => {
      toast.warning(`${a.vehicleName ?? "A vehicle"}: ${a.ruleName}`, {
        description: timeRef.current.time(a.occurredAt),
        action: { label: "View", onClick: () => window.location.assign("/alerts") }
      });
    }
  });

  // Fit to the fleet (first snapshot, or on demand). Fallback: North America.
  const fitFleet = useCallback(
    (animate = true) => {
      const m = map ?? mapRef.current;
      if (!m) return;
      const b = new maplibregl.LngLatBounds();
      for (const d of devices.current.values()) if (d.location) b.extend([d.location.longitude, d.location.latitude]);
      if (b.isEmpty()) return;
      if (!animate && fitted.current) return;
      fitted.current = true;
      m.fitBounds(b, { padding: { top: 80, bottom: 80, left: 80, right: 80 }, maxZoom: 14, duration: animate ? 600 : 0 });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map]
  );

  // Map init (once).
  useEffect(() => {
    if (!mapDiv.current) return;
    const m = new maplibregl.Map({ container: mapDiv.current, style: STYLE_URL, center: FALLBACK_VIEW.center, zoom: FALLBACK_VIEW.zoom, attributionControl: { compact: true } });
    mapRef.current = m;
    m.getCanvas().setAttribute("aria-label", "Fleet map. Use the vehicle list for keyboard access.");
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    m.addControl(new maplibregl.FullscreenControl(), "top-right");
    m.on("styleimagemissing", (e) => {
      // The OpenFreeMap style references a few icons its sprite doesn't ship.
      if (!m.hasImage(e.id)) m.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
    // Panning by hand means "let me look around": stop following.
    m.on("dragstart", () => setFollow(false));
    m.on("error", (e) => {
      console.error("map error", e.error);
      if (!m.isStyleLoaded()) setMapError("Map tiles failed to load. Vehicle positions are still updating in the list.");
    });
    const fl = new FleetLayer(m, {
      onSelect: (id) => setSelected(id),
      onHover: (id, ll) => {
        hover.current?.remove();
        hover.current = null;
        if (!id || !ll) return;
        const d = devicesRef.current.get(id);
        if (!d) return;
        const el = document.createElement("div");
        el.className = "text-xs font-medium";
        el.textContent = deviceLabel(d);
        hover.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 16 }).setLngLat(ll).setDOMContent(el).addTo(m);
      }
    });
    layer.current = fl;
    m.on("load", () => {
      setMapError(null);
      m.addSource("track", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "track-line", type: "line", source: "track", paint: { "line-color": "#2f5bea", "line-width": 4, "line-opacity": 0.85 }, layout: { "line-join": "round", "line-cap": "round" } });
      fl.install();
      m.addSource("track-pos", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({
        id: "track-pos",
        type: "symbol",
        source: "track-pos",
        layout: { "icon-image": "veh-moving", "icon-rotate": ["to-number", ["coalesce", ["get", "heading"], 0]], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-size": 1.15 }
      });
      // Seed from whatever the stream already has (snapshot may arrive before the style).
      fl.reset([...devicesRef.current.values()].map((d) => toPoint(d, Date.now(), offlineSeconds)).filter((p): p is FleetPoint => p !== null));
      fitFleetRef.current(false);
      // Zones overlay (skipped if the role can't read zones).
      fetch("/api/geofences", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((b: { geofences: GeofenceDto[] } | null) => {
          if (!b || !mapRef.current) return;
          m.addSource("fences", {
            type: "geojson",
            data: { type: "FeatureCollection", features: b.geofences.map((f) => ({ type: "Feature", properties: { name: f.name, color: f.color }, geometry: { type: "Polygon", coordinates: [shapeRing(f.shape)] } })) }
          });
          m.addLayer({ id: "fences-fill", type: "fill", source: "fences", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.1 } }, "track-line");
          m.addLayer({ id: "fences-line", type: "line", source: "fences", paint: { "line-color": ["get", "color"], "line-width": 1.5 } }, "track-line");
          if (m.getStyle().glyphs) {
            m.addLayer(
              { id: "fences-label", type: "symbol", source: "fences", minzoom: 12, layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 12 }, paint: { "text-color": "#374151", "text-halo-color": "#fff", "text-halo-width": 1.5 } },
              "track-line"
            );
          }
        })
        .catch((err) => console.error("zones failed to load", err));
    });
    setMap(m);
    return () => {
      fl.destroy();
      m.remove();
      mapRef.current = null;
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const devicesRef = devices;
  const fitFleetRef = useRef(fitFleet);
  fitFleetRef.current = fitFleet;

  // Re-evaluate offline state periodically (no events arrive from a silent device).
  useEffect(() => {
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      const pts = [...devices.current.values()].map((d) => toPoint(d, n, offlineSeconds)).filter((p): p is FleetPoint => p !== null);
      layer.current?.upsert(pts.filter((p) => p.state === "offline"));
    }, 30_000);
    return () => clearInterval(t);
  }, [devices, offlineSeconds]);

  // Deep link from trip reports: /map?device=<id>&from=<ISO>&to=<ISO>
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const device = q.get("device");
    const f = q.get("from");
    const t = q.get("to");
    if (device && f && t && !Number.isNaN(Date.parse(f)) && !Number.isNaN(Date.parse(t))) setDeepLink({ device, from: f, to: t });
    const focusId = q.get("focus");
    if (focusId) setFocusParam(focusId);
  }, []);
  // /map?focus=<deviceId> (from Vehicles "Show on map"): select and center once the snapshot has it.
  const [focusParam, setFocusParam] = useState<string | null>(null);
  useEffect(() => {
    if (!focusParam || !loaded || !map) return;
    if (devices.current.has(focusParam)) focus(focusParam);
    setFocusParam(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusParam, loaded, map, version]);
  useEffect(() => {
    if (deepLink && loaded && devices.current.has(deepLink.device)) {
      setSelected(deepLink.device);
      setHistoryFor(deepLink.device);
    }
  }, [deepLink, loaded, devices, version]);

  // List (recomputed at most once per stream tick, not per GPS event).
  const all = useMemo(() => {
    const rows = [...devices.current.values()].map((d) => ({ d, state: mapState(d, now, offlineSeconds), name: deviceLabel(d) }));
    const byName = (a: (typeof rows)[number], b: (typeof rows)[number]) => a.name.localeCompare(b.name, undefined, { numeric: true });
    rows.sort(
      sort === "name"
        ? byName
        : sort === "recent"
          ? (a, b) => Date.parse(b.d.lastSeenAt ?? "1970-01-01") - Date.parse(a.d.lastSeenAt ?? "1970-01-01") || byName(a, b)
          : sort === "speed"
            ? (a, b) => (b.d.location?.speedKph ?? -1) - (a.d.location?.speedKph ?? -1) || byName(a, b)
            : (a, b) => MAP_STATES.indexOf(a.state) - MAP_STATES.indexOf(b.state) || byName(a, b)
    );
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, now, offlineSeconds, sort]);
  // Group filter: the list, the counts and the map all narrow to the group's vehicles.
  const groupSet = useMemo(() => {
    const g = groups.find((x) => x.id === groupId);
    return g ? new Set(g.vehicleIds) : null;
  }, [groups, groupId]);
  const scoped = useMemo(() => (groupSet ? all.filter((r) => r.d.vehicle && groupSet.has(r.d.vehicle.id)) : all), [all, groupSet]);
  const counts = useMemo(() => {
    const c = { all: scoped.length, moving: 0, idle: 0, stopped: 0, offline: 0 };
    for (const r of scoped) c[r.state]++;
    return c;
  }, [scoped]);
  const q = search.trim().toLowerCase();
  const rows = useMemo(
    () => scoped.filter((r) => (filter === "all" || r.state === filter) && (!q || r.name.toLowerCase().includes(q) || (r.d.vehicle?.licensePlate ?? "").toLowerCase().includes(q))),
    [scoped, filter, q]
  );

  // Keep the map filter in step with the list.
  useEffect(() => {
    layer.current?.filter(filter === "all" ? null : [filter], q || groupSet ? new Set(rows.map((r) => r.d.deviceId)) : null);
  }, [filter, q, groupSet, rows]);

  useEffect(() => {
    layer.current?.setLabels(showLabels);
  }, [showLabels, map]);
  useEffect(() => {
    layer.current?.setClustering(clustered);
  }, [clustered, map]);

  /** Download what the list shows right now (after search and filters) as a spreadsheet file. */
  const exportCsv = () => {
    const head = ["vehicle", "plate", "type", "status", `speed_${u.speed === "mph" ? "mph" : "kmh"}`, "ignition", "latitude", "longitude", "last_gps_fix", "time_zone"];
    const lines = rows.map((r) => {
      const l = r.d.location;
      return [
        r.name,
        r.d.vehicle?.licensePlate ?? "",
        r.d.vehicle ? VEHICLE_TYPE_LABEL[asVehicleType(r.d.vehicle.type)] : "",
        STATE_LABEL[r.state],
        l?.speedKph === null || l?.speedKph === undefined ? "" : Math.round(u.speed_(l.speedKph)),
        l?.ignition === null || l?.ignition === undefined ? "" : l.ignition ? "on" : "off",
        l ? l.latitude.toFixed(6) : "",
        l ? l.longitude.toFixed(6) : "",
        l ? time.iso(l.recordedAt) : "",
        l ? time.abbr(l.recordedAt) : ""
      ]
        .map(csvSafe)
        .join(",");
    });
    const blob = new Blob([[head.join(","), ...lines].join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fleet-positions-${time.dayKey(new Date().toISOString())}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast.success(`Exported ${rows.length} vehicle${rows.length === 1 ? "" : "s"}.`);
  };
  useEffect(() => {
    if (!map) return;
    for (const id of ZONE_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", showZones ? "visible" : "none");
  }, [showZones, map]);
  // Following only makes sense while one vehicle is selected.
  useEffect(() => {
    if (!selected) setFollow(false);
  }, [selected]);

  // Selection: halo + popup.
  const sel = selected ? devices.current.get(selected) : undefined;
  const selState: MapState = sel ? mapState(sel, now, offlineSeconds) : "offline";
  useEffect(() => {
    layer.current?.select(selected);
    popup.current?.remove();
    popup.current = null;
    const m = map;
    if (!m || !sel?.location) return;
    const el = document.createElement("div");
    el.className = "grid gap-0.5 text-[13px]";
    const t = document.createElement("strong");
    t.textContent = deviceLabel(sel);
    const s = document.createElement("span");
    s.textContent = `${STATE_LABEL[mapState(sel, Date.now(), offlineSeconds)]} · ${u.fmtSpeed(sel.location.speedKph)} · ignition ${sel.location.ignition === null ? "unknown" : sel.location.ignition ? "on" : "off"}`;
    const w = document.createElement("span");
    w.className = "text-muted-foreground";
    w.textContent = `GPS fix ${timeRef.current.dateTimeSec(sel.location.recordedAt)} ${timeRef.current.abbr(sel.location.recordedAt)}`;
    el.append(t, s, w);
    const ll = layer.current?.displayed(sel.deviceId) ?? [sel.location.longitude, sel.location.latitude];
    popup.current = new maplibregl.Popup({ offset: 18, closeButton: true, maxWidth: "260px" }).setLngLat(ll).setDOMContent(el).addTo(m);
    popup.current.on("close", () => setSelected((cur) => (cur === sel.deviceId ? null : cur)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, map, version]);

  const focus = useCallback(
    (id: string) => {
      setSelected(id);
      setSheetOpen(false);
      const d = devices.current.get(id);
      if (d?.location) map?.flyTo({ center: [d.location.longitude, d.location.latitude], zoom: Math.max(map.getZoom(), 14), duration: 700 });
    },
    [map, devices]
  );

  // Windowed list: only the visible rows are rendered.
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Keep the selected vehicle's row in view (selection can come from the map, a link or search).
  useEffect(() => {
    const el = listRef.current;
    if (!el || !selected) return;
    const i = rows.findIndex((r) => r.d.deviceId === selected);
    if (i < 0) return;
    const top = i * ROW_H;
    if (top < el.scrollTop || top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTo({ top: Math.max(0, top - el.clientHeight / 2 + ROW_H / 2) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 5);
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewH) / ROW_H) + 5);

  const connLabel = conn === "live" ? "Live" : conn === "connecting" ? "Connecting…" : "Reconnecting…";
  const historyDevice = historyFor ? devices.current.get(historyFor) : undefined;

  const panel = (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h1 className="m-0 text-base font-semibold">Live tracking</h1>
          <p className="m-0 text-xs text-muted-foreground">
            {counts.all} vehicle{counts.all === 1 ? "" : "s"} on the map
          </p>
        </div>
        <span role="status" className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", conn === "live" ? "bg-success-soft text-success" : "bg-warning-soft text-warning")}>
          {conn === "live" ? <span aria-hidden="true" className="live-ping inline-block size-2 rounded-full bg-current" /> : <Radio className="size-3.5" aria-hidden="true" />} {connLabel}
        </span>
      </div>

      {historyFor && historyDevice ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <HistoryPanel
            key={historyFor}
            map={map}
            deviceId={historyFor}
            deviceName={deviceLabel(historyDevice)}
            initial={deepLink?.device === historyFor ? deepLink : null}
            onClose={() => {
              setHistoryFor(null);
              setDeepLink(null);
            }}
          />
        </div>
      ) : (
        <>
          <div className="grid gap-2 border-b border-border px-4 py-3">
            <SearchInput value={search} onChange={setSearch} placeholder="Search vehicles…" label="Search vehicles" debounceMs={150} />
            {groups.length > 0 && (
              <Select aria-label="Filter by group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">All groups</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.vehicleIds.length})
                  </option>
                ))}
              </Select>
            )}
            <div className="flex gap-2">
              <Select aria-label="Sort vehicles" className="min-w-0 flex-1" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                <option value="status">Sort: status</option>
                <option value="name">Sort: name</option>
                <option value="recent">Sort: latest update</option>
                <option value="speed">Sort: speed</option>
              </Select>
              <Button size="md" variant="secondary" className="shrink-0 px-3" onClick={exportCsv} disabled={rows.length === 0} aria-label="Export this list as CSV" title="Export this list as CSV">
                <Download />
              </Button>
            </div>
            <div role="group" aria-label="Filter by status" className="grid grid-cols-5 gap-1">
              {(["all", ...MAP_STATES] as Filter[]).map((f) => {
                const on = filter === f;
                return (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={on}
                    title={f === "all" ? "Every vehicle" : STATE_HINT[f]}
                    onClick={() => setFilter(on && f !== "all" ? "all" : f)}
                    className={cn(
                      "grid cursor-pointer justify-items-center gap-0.5 rounded-lg border bg-background px-1 py-1.5 hover:bg-muted",
                      on ? "border-primary bg-primary-soft hover:bg-primary-soft" : "border-border"
                    )}
                  >
                    <span className="text-base font-semibold leading-5 tabular-nums">{counts[f]}</span>
                    <span className="flex items-center gap-1 text-[11px] leading-4 text-muted-foreground">
                      {f !== "all" && <span aria-hidden="true" className="inline-block size-1.5 rounded-full" style={{ background: STATE_COLORS[f] }} />}
                      {f === "all" ? "All" : STATE_LABEL[f]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {sel && (
            <section key={sel.deviceId} aria-label="Selected vehicle" className="grid animate-in gap-3 border-b border-border bg-primary-soft/50 px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="m-0 truncate text-sm font-semibold">{deviceLabel(sel)}</h2>
                  <p className="m-0 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <StateDot state={selState} />
                    <span className="font-medium text-foreground">{STATE_LABEL[selState]}</span>
                    {sel.vehicle && <span className="truncate">· {[VEHICLE_TYPE_LABEL[asVehicleType(sel.vehicle.type)], sel.vehicle.licensePlate].filter(Boolean).join(" · ")}</span>}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Close vehicle details"
                  className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setSelected(null)}
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
              {sel.location ? (
                <>
                  <dl className="m-0 grid grid-cols-3 gap-x-3 gap-y-2">
                    <Stat label="Speed" value={u.fmtSpeed(sel.location.speedKph)} />
                    <Stat label="Ignition" value={sel.location.ignition === null ? "Unknown" : sel.location.ignition ? "On" : "Off"} />
                    <Stat label="Heading" value={selState === "moving" ? (compass(sel.location.headingDeg) ?? "–") : "–"} />
                    <div className="col-span-3 min-w-0">
                      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Last GPS fix</dt>
                      <dd className="m-0 truncate text-sm font-medium">
                        {time.dateTimeSec(sel.location.recordedAt)} {time.abbr(sel.location.recordedAt)} <span className="font-normal text-muted-foreground">({ago(sel.location.recordedAt, now)})</span>
                      </dd>
                    </div>
                  </dl>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span className="truncate tabular-nums">
                      {sel.location.latitude.toFixed(5)}, {sel.location.longitude.toFixed(5)}
                    </span>
                    <button
                      type="button"
                      aria-label="Copy coordinates"
                      className="grid size-6 shrink-0 cursor-pointer place-items-center rounded border-0 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() => {
                        const text = `${sel.location!.latitude.toFixed(6)}, ${sel.location!.longitude.toFixed(6)}`;
                        navigator.clipboard.writeText(text).then(
                          () => toast.success("Coordinates copied."),
                          () => toast.error("Couldn't copy. Select the coordinates and copy them.")
                        );
                      }}
                    >
                      <Copy className="size-3.5" aria-hidden="true" />
                    </button>
                    <a
                      className="ml-auto inline-flex shrink-0 items-center gap-1 text-primary hover:underline"
                      href={`https://www.google.com/maps/search/?api=1&query=${sel.location.latitude.toFixed(6)},${sel.location.longitude.toFixed(6)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Google Maps <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                  </div>
                </>
              ) : (
                <p className="m-0 text-xs text-muted-foreground">This tracker hasn&apos;t reported a position yet.</p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => focus(sel.deviceId)} disabled={!sel.location}>
                  <Crosshair /> Center
                </Button>
                <Button
                  size="sm"
                  variant={follow ? "primary" : "secondary"}
                  aria-pressed={follow}
                  disabled={!sel.location}
                  onClick={() => {
                    if (!follow) focus(sel.deviceId);
                    setFollow((v) => !v);
                  }}
                >
                  <LocateFixed /> {follow ? "Following" : "Follow"}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setHistoryFor(sel.deviceId)}>
                  <History /> History
                </Button>
                {canShare && sel.vehicle && (
                  <Button size="sm" variant="secondary" onClick={() => setSharing(true)}>
                    <Share2 /> Share
                  </Button>
                )}
              </div>
            </section>
          )}

          <div ref={listRef} className="relative min-h-0 flex-1 overflow-auto" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
            {!loaded ? (
              <div className="grid gap-3 p-4" aria-busy="true" aria-label="Loading vehicles">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-11" />
                ))}
              </div>
            ) : all.length === 0 ? (
              <EmptyState
                icon={Truck}
                title="No vehicles on the map yet"
                description="Add a vehicle and assign a GPS device. It appears here as soon as the device reports a position."
                action={
                  <Button asChild size="sm">
                    <Link href="/vehicles">Go to vehicles</Link>
                  </Button>
                }
              />
            ) : rows.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No vehicles match this filter.</p>
            ) : (
              <ul className="relative m-0 list-none p-0" style={{ height: rows.length * ROW_H }} aria-label="Vehicles">
                {rows.slice(start, end).map((r, i) => {
                  const d = r.d;
                  const active = d.deviceId === selected;
                  return (
                    <li key={d.deviceId} className="absolute inset-x-0" style={{ top: (start + i) * ROW_H, height: ROW_H }}>
                      <button
                        type="button"
                        onClick={() => focus(d.deviceId)}
                        aria-pressed={active}
                        className={cn(
                          "flex h-full w-full cursor-pointer flex-col justify-center gap-0.5 border-0 border-b border-border/70 bg-transparent px-4 text-left hover:bg-muted",
                          active && "bg-primary-soft hover:bg-primary-soft"
                        )}
                      >
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <span
                            aria-hidden="true"
                            className="-ml-1 grid size-6 shrink-0 place-items-center rounded-full text-white"
                            style={{ background: STATE_COLORS[r.state], ["--vehicle-icon-gap" as string]: STATE_COLORS[r.state] }}
                          >
                            <VehicleTypeIcon type={d.vehicle?.type ?? "other"} className="size-3.5" />
                          </span>
                          <span className="truncate">{r.name}</span>
                          <span className="ml-auto shrink-0 text-xs font-normal tabular-nums text-muted-foreground">
                            {r.state === "moving" && d.location ? u.fmtSpeed(d.location.speedKph) : STATE_LABEL[r.state]}
                          </span>
                        </span>
                        <span className="flex gap-1.5 pl-7 text-xs text-muted-foreground">
                          <span className="truncate">{d.location ? [d.vehicle?.licensePlate, r.state === "moving" ? "Moving" : STATE_HINT[r.state]].filter(Boolean).join(" · ") : "No position yet"}</span>
                          <span className="ml-auto shrink-0">{ago(d.lastSeenAt, now)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </>
  );

  return (
    <div className="absolute inset-0 flex">
      <div className="relative order-2 min-w-0 flex-1">
        {/* maplibre's CSS sets position:relative on the map element, so size it via a wrapper. */}
        <div className="absolute inset-0">
          <div ref={mapDiv} className="h-full w-full" />
        </div>
        <div className="absolute left-3 top-3 z-[1] flex flex-wrap gap-2 pr-14">
          <Button
            size="sm"
            variant="secondary"
            className="hidden md:inline-flex"
            aria-expanded={panelOpen}
            aria-label={panelOpen ? "Hide vehicle panel" : "Show vehicle panel"}
            title={panelOpen ? "Hide vehicle panel" : "Show vehicle panel"}
            onClick={() => setPanelOpen((v) => !v)}
          >
            {panelOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => fitFleet(true)} disabled={counts.all === 0}>
            <Maximize2 /> Fit all
          </Button>
          <Button size="sm" variant="secondary" aria-pressed={showLabels} className={cn(!showLabels && "text-muted-foreground")} onClick={() => setShowLabels((v) => !v)}>
            <Tag /> <span className="sr-only sm:not-sr-only">Names</span>
          </Button>
          <Button size="sm" variant="secondary" aria-pressed={clustered} className={cn(!clustered && "text-muted-foreground")} title="Group nearby vehicles when zoomed out" onClick={() => setClustered((v) => !v)}>
            <CircleDotDashed /> <span className="sr-only sm:not-sr-only">Cluster</span>
          </Button>
          <Button size="sm" variant="secondary" aria-pressed={showZones} className={cn(!showZones && "text-muted-foreground")} onClick={() => setShowZones((v) => !v)}>
            <Hexagon /> <span className="sr-only sm:not-sr-only">Zones</span>
          </Button>
        </div>
        {follow && sel && (
          <div className="pointer-events-none absolute inset-x-0 bottom-[160px] z-[1] flex justify-center md:bottom-4">
            <span role="status" className="pointer-events-auto inline-flex animate-in items-center gap-2 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background shadow-pop">
              <LocateFixed className="size-3.5" aria-hidden="true" /> Following {deviceLabel(sel)}
              <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-xs font-medium text-background underline" onClick={() => setFollow(false)}>
                Stop
              </button>
            </span>
          </div>
        )}
        {mapError && (
          <div className="absolute inset-x-3 top-14 z-[1] md:right-14">
            <Alert tone="warning">{mapError}</Alert>
          </div>
        )}
      </div>

      {/* One panel: bottom sheet on phones, side panel from md up. */}
      <aside
        aria-label="Vehicles"
        className={cn(
          "absolute inset-x-0 bottom-0 z-[2] flex flex-col rounded-t-xl border-t border-border bg-background shadow-pop transition-[height] duration-200",
          sheetOpen || historyFor ? "h-[70%]" : "h-[148px]",
          "md:static md:order-1 md:h-auto md:w-[340px] md:shrink-0 md:rounded-none md:border-r md:border-t-0 md:shadow-none md:transition-none",
          !panelOpen && "md:hidden"
        )}
      >
        <button
          type="button"
          className="flex shrink-0 cursor-pointer items-center justify-center gap-1 border-0 bg-transparent py-1.5 text-xs text-muted-foreground md:hidden"
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen((v) => !v)}
        >
          <ChevronUp className={cn("size-4 transition-transform", sheetOpen && "rotate-180")} aria-hidden="true" />
          {sheetOpen ? "Hide vehicle list" : "Show vehicle list"}
        </button>
        <div className="flex min-h-0 flex-1 flex-col">{panel}</div>
      </aside>
      {sharing && sel?.vehicle && <ShareDialog vehicle={{ id: sel.vehicle.id, name: sel.vehicle.name, hasDevice: true }} onClose={() => setSharing(false)} />}
    </div>
  );
}
