"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibregl, { type Map as MlMap, type Popup } from "maplibre-gl";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Box, Check, ChevronDown, ChevronUp, Copy, Cpu, Crosshair, Download, Expand, ExternalLink, History, Layers, Locate, LocateFixed, Maximize2, Minus, Navigation2, PanelLeftClose, PanelLeftOpen, Plus, Radio, Share2, Shrink, Truck, X } from "lucide-react";
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
import { MAP_STYLES, type MapStyleId, saveStyle, savedStyle, setBuildings3d, styleUrl } from "@/lib/map-style";
import type { CurrentDeviceLocation } from "@/lib/locations";
import { FleetLayer, STATE_COLORS, type FleetPoint } from "./fleet-layer";
import { compass, csvSafe, deviceLabel, FALLBACK_VIEW, mapState, MAP_STATES, STATE_ORDER, stateBucket, type MapState } from "./fleet-model";
import { useFleetStream } from "./use-fleet-stream";

// Loaded on first use: most sessions never open history.
const HistoryPanel = dynamic(() => import("./history-panel").then((m) => m.HistoryPanel), { ssr: false });
const ShareDialog = dynamic(() => import("../vehicles/share-dialog").then((m) => m.ShareDialog), { ssr: false });

const ROW_H = 68;
const STATE_LABEL: Record<MapState, string> = { moving: "Moving", idle: "Idling", stopped: "Stopped", parked: "Parked (unhooked)", offline: "Offline" };
const STATE_HINT: Record<MapState, string> = {
  moving: "Travelling",
  idle: "Engine on, not moving",
  stopped: "Parked, engine off",
  parked: "Unhooked, at last known spot",
  offline: "Tracker not reporting"
};
/** Badge grounds: the status colour's soft tint (text uses the status colour itself). */
const STATE_TINT: Record<MapState, string> = { moving: "#e9f7ee", idle: "#fff5e1", stopped: "#e8f4fb", parked: "#e8f4fb", offline: "#eef0f3" };
const STATE_BADGE: Record<MapState, string> = { moving: "Moving", idle: "Idling", stopped: "Stopped", parked: "Unhooked", offline: "Offline" };
/** Floating map controls: white, raised, 40px targets. */
const MAP_BTN =
  "grid size-10 cursor-pointer place-items-center border-0 bg-background text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default disabled:opacity-50";
/** Tracker names often carry the IMEI, e.g. "FTM164 (868038076566554)": show "FTM164" and "…6554". */
function splitName(name: string): { main: string; imei: string | null } {
  const m = /^(.*?)\s*\((\d{6,})\)\s*$/.exec(name);
  return m && m[1] && m[2] ? { main: m[1], imei: `…${m[2].slice(-4)}` } : { main: name, imei: null };
}
/** Below this width the card sits over the bottom sheet instead of beside the list. */
const WIDE = "(min-width: 768px)";
const ZONE_LAYERS = ["fences-fill", "fences-line", "fences-label"];
type Filter = "all" | Exclude<MapState, "parked">;

function ago(iso: string | null, now: number) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

const SUB: Record<MapState, string> = { moving: "", idle: "Idling", stopped: "Parked", parked: "Unhooked", offline: "Offline" };

function toPoint(d: CurrentDeviceLocation, now: number, offlineSeconds: number, fmtSpeed?: (kph: number) => string): FleetPoint | null {
  if (!d.location) return null;
  const state = mapState(d, now, offlineSeconds);
  return {
    sub: state === "moving" ? (fmtSpeed && d.location.speedKph !== null ? fmtSpeed(d.location.speedKph) : "") : SUB[state],
    id: d.deviceId,
    name: deviceLabel(d),
    state,
    type: d.vehicle ? asVehicleType(d.vehicle.type) : "other",
    lngLat: [d.location.longitude, d.location.latitude],
    heading: d.location.headingDeg
  };
}

function StatusBadge({ state }: { state: MapState }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full px-2 text-xs font-semibold leading-[18px]" style={{ background: STATE_TINT[state], color: STATE_COLORS[state] }}>
      {STATE_BADGE[state]}
    </span>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="m-0 truncate text-[15px] font-semibold tabular-nums" title={hint}>
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
  const showZonesRef = useRef(true);
  showZonesRef.current = showZones;
  const [follow, setFollow] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [mapStyle, setMapStyle] = useState<MapStyleId>("streets");
  const [bearing, setBearing] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [is3d, setIs3d] = useState(false);
  const is3dRef = useRef(false);
  is3dRef.current = is3d;
  const styleRef = useRef<MapStyleId>("streets");
  styleRef.current = mapStyle;
  /** Pan the map so a vehicle picked on the map isn't left under the card. */
  const centerOnRef = useRef<(id: string) => void>(() => undefined);
  const shellRef = useRef<HTMLDivElement>(null);
  /** Zones are fetched once and re-added whenever the base map changes. */
  const fencesRef = useRef<GeofenceDto[] | null>(null);
  // Read inside stream callbacks that are created once.
  const followRef = useRef<string | null>(null);
  followRef.current = follow ? selected : null;

  const mapRef = useRef<MlMap | null>(null);

  const { devices, conn, version, loaded } = useFleetStream({
    onSnapshot: (list) => {
      const pts = list.map((d) => toPoint(d, Date.now(), offlineSeconds, u.fmtSpeed)).filter((p): p is FleetPoint => p !== null);
      layer.current?.reset(pts);
      fitFleet(false);
    },
    onUpdate: (list) => {
      const pts = list.map((d) => toPoint(d, Date.now(), offlineSeconds, u.fmtSpeed)).filter((p): p is FleetPoint => p !== null);
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
    const initialStyle = savedStyle();
    setMapStyle(initialStyle);
    const m = new maplibregl.Map({ container: mapDiv.current, style: styleUrl(initialStyle), center: FALLBACK_VIEW.center, zoom: FALLBACK_VIEW.zoom, attributionControl: { compact: true } });
    mapRef.current = m;
    m.getCanvas().setAttribute("aria-label", "Fleet map. Use the vehicle list for keyboard access.");
    m.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: u.speed === "mph" ? "imperial" : "metric" }), "bottom-right");
    m.on("styleimagemissing", (e) => {
      // The OpenFreeMap styles reference a few icons their sprites don't ship.
      if (!m.hasImage(e.id)) m.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
    // Panning by hand means "let me look around": stop following.
    m.on("dragstart", () => setFollow(false));
    m.on("rotate", () => setBearing(m.getBearing()));
    m.on("error", (e) => {
      console.error("map error", e.error);
      if (!m.isStyleLoaded()) setMapError("Map tiles failed to load. Vehicle positions are still updating in the list.");
    });
    const fl = new FleetLayer(m, {
      onSelect: (id) => {
        setSelected(id);
        centerOnRef.current(id);
      },
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

    const addFences = (list: GeofenceDto[]) => {
      if (m.getSource("fences")) return;
      m.addSource("fences", {
        type: "geojson",
        data: { type: "FeatureCollection", features: list.map((f) => ({ type: "Feature", properties: { name: f.name, color: f.color }, geometry: { type: "Polygon", coordinates: [shapeRing(f.shape)] } })) }
      });
      m.addLayer({ id: "fences-fill", type: "fill", source: "fences", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.1 } }, "track-line");
      m.addLayer({ id: "fences-line", type: "line", source: "fences", paint: { "line-color": ["get", "color"], "line-width": 1.5 } }, "track-line");
      if (m.getStyle().glyphs) {
        m.addLayer(
          { id: "fences-label", type: "symbol", source: "fences", minzoom: 12, layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 12 }, paint: { "text-color": "#374151", "text-halo-color": "#fff", "text-halo-width": 1.5 } },
          "track-line"
        );
      }
      const visible = showZonesRef.current ? "visible" : "none";
      for (const id of ZONE_LAYERS) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", visible);
    };

    // Runs for the first style and again after every base-map switch (setStyle drops our layers).
    let first = true;
    m.on("style.load", () => {
      setMapError(null);
      if (!m.getSource("track")) {
        m.addSource("track", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: "track-line", type: "line", source: "track", paint: { "line-color": "#2f5bea", "line-width": 4, "line-opacity": 0.85 }, layout: { "line-join": "round", "line-cap": "round" } });
      }
      fl.install();
      if (is3dRef.current) setBuildings3d(m, true, styleRef.current === "dark");
      if (!m.getSource("track-pos")) {
        m.addSource("track-pos", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({
          id: "track-pos",
          type: "symbol",
          source: "track-pos",
          layout: { "icon-image": "veh-moving", "icon-rotate": ["to-number", ["coalesce", ["get", "heading"], 0]], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-size": 1.15 }
        });
      }
      if (first) {
        first = false;
        // Seed from whatever the stream already has (snapshot may arrive before the style).
        fl.reset([...devicesRef.current.values()].map((d) => toPoint(d, Date.now(), offlineSeconds, u.fmtSpeed)).filter((p): p is FleetPoint => p !== null));
        fitFleetRef.current(false);
        // Zones overlay (skipped if the role can't read zones).
        fetch("/api/geofences", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .then((b: { geofences: GeofenceDto[] } | null) => {
            if (!b || !mapRef.current) return;
            fencesRef.current = b.geofences;
            addFences(b.geofences);
          })
          .catch((err) => console.error("zones failed to load", err));
      } else if (fencesRef.current) {
        addFences(fencesRef.current);
      }
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

  // Base-map switch: remembered per browser.
  const switchStyle = (id: MapStyleId) => {
    setMapStyle(id);
    styleRef.current = id;
    saveStyle(id);
    mapRef.current?.setStyle(styleUrl(id));
  };

  // 3D: tilt the camera and raise buildings to their real height (like Mapbox's 3D view).
  const toggle3d = () => {
    const m = mapRef.current;
    if (!m) return;
    const on = !is3d;
    setIs3d(on);
    setBuildings3d(m, on, mapStyle === "dark");
    m.easeTo({ pitch: on ? 55 : 0, zoom: on ? Math.max(m.getZoom(), 15) : m.getZoom(), duration: 700 });
  };

  // Full screen for the whole tracking view (list + map), not just the canvas.
  useEffect(() => {
    const on = () => setFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    else shellRef.current?.requestFullscreen().catch(() => toast.error("Full screen isn't available in this browser."));
  };

  const locateMe = () => {
    if (!navigator.geolocation) {
      toast.error("Your browser can't share its location.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFollow(false);
        mapRef.current?.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: Math.max(mapRef.current.getZoom(), 13), duration: 700 });
      },
      () => toast.error("Couldn't get your location. Check the browser's location permission."),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 }
    );
  };

  const devicesRef = devices;
  const fitFleetRef = useRef(fitFleet);
  fitFleetRef.current = fitFleet;

  // Re-evaluate offline state periodically (no events arrive from a silent device).
  useEffect(() => {
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      const pts = [...devices.current.values()].map((d) => toPoint(d, n, offlineSeconds, u.fmtSpeed)).filter((p): p is FleetPoint => p !== null);
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
            : (a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || byName(a, b)
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
    for (const r of scoped) c[stateBucket(r.state)]++;
    return c;
  }, [scoped]);
  const q = search.trim().toLowerCase();
  const rows = useMemo(
    () => scoped.filter((r) => (filter === "all" || stateBucket(r.state) === filter) && (!q || r.name.toLowerCase().includes(q) || (r.d.vehicle?.licensePlate ?? "").toLowerCase().includes(q))),
    [scoped, filter, q]
  );

  // Keep the map filter in step with the list.
  useEffect(() => {
    layer.current?.filter(filter === "all" ? null : filter === "stopped" ? ["stopped", "parked"] : [filter], q || groupSet ? new Set(rows.map((r) => r.d.deviceId)) : null);
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

  // Selection: halo on the map; details show in the floating card.
  const sel = selected ? devices.current.get(selected) : undefined;
  const selState: MapState = sel ? mapState(sel, now, offlineSeconds) : "offline";
  useEffect(() => {
    layer.current?.select(selected);
  }, [selected, map]);
  useEffect(() => {
    if (!selected) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !historyFor && !sharing) setSelected(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [selected, historyFor, sharing]);

  // Room for the vehicle card: beside it on wide screens, above it on phones. The padding stays on the
  // camera, so later centering (Follow, Center) also keeps the vehicle clear of the card.
  const paddedRef = useRef(false);
  const cardPadding = () => {
    paddedRef.current = true;
    return window.matchMedia(WIDE).matches ? { top: 0, right: 0, bottom: 0, left: 392 } : { top: 0, right: 0, bottom: 480, left: 0 };
  };
  const focus = useCallback(
    (id: string) => {
      setSelected(id);
      setSheetOpen(false);
      const d = devices.current.get(id);
      if (d?.location) map?.flyTo({ center: [d.location.longitude, d.location.latitude], zoom: Math.max(map.getZoom(), 14), padding: cardPadding(), duration: 700 });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map, devices]
  );
  centerOnRef.current = (id: string) => {
    const d = devices.current.get(id);
    if (d?.location) mapRef.current?.easeTo({ center: [d.location.longitude, d.location.latitude], padding: cardPadding(), duration: 500 });
  };
  // Card closed (or history opened): give the map its full area back.
  useEffect(() => {
    if ((selected && !historyFor) || !paddedRef.current) return;
    paddedRef.current = false;
    mapRef.current?.easeTo({ padding: { top: 0, right: 0, bottom: 0, left: 0 }, duration: 300 });
  }, [selected, historyFor]);

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
      <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
        <div className="min-w-0">
          <h1 className="m-0 text-xl font-bold tracking-tight">Live tracking</h1>
          <p className="m-0 text-xs text-muted-foreground">
            {counts.all} vehicle{counts.all === 1 ? "" : "s"}
            {counts.offline > 0 && ` · ${counts.offline} not reporting`}
          </p>
        </div>
        <span role="status" className={cn("mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold", conn === "live" ? "bg-success-soft text-success" : "bg-warning-soft text-warning")}>
          {conn === "live" ? <span aria-hidden="true" className="live-ping inline-block size-2 rounded-full bg-current" /> : <Radio className="size-3.5" aria-hidden="true" />} {connLabel}
        </span>
      </div>

      {historyFor && historyDevice ? (
        <div className="min-h-0 flex-1 overflow-auto border-t border-border">
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
          <div className="grid gap-3 border-b border-border px-5 pb-4">
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <SearchInput value={search} onChange={setSearch} placeholder="Search name or plate" label="Search vehicles" debounceMs={150} />
              </div>
              <Button size="md" variant="secondary" className="shrink-0 px-3" onClick={exportCsv} disabled={rows.length === 0} aria-label="Export this list as CSV" title="Export this list as CSV">
                <Download />
              </Button>
            </div>
            <div className="flex gap-2">
              {groups.length > 0 && (
                <Select aria-label="Filter by group" className="min-w-0 flex-1" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                  <option value="">All groups</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.vehicleIds.length})
                    </option>
                  ))}
                </Select>
              )}
              <Select aria-label="Sort vehicles" className="min-w-0 flex-1" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                <option value="status">Sort: status</option>
                <option value="name">Sort: name</option>
                <option value="recent">Sort: latest update</option>
                <option value="speed">Sort: speed</option>
              </Select>
            </div>
            <div role="group" aria-label="Filter by status" className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none]">
              {(["all", ...MAP_STATES] as Filter[]).map((f) => {
                const on = filter === f;
                const n = counts[f];
                return (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={on}
                    title={f === "all" ? "Every vehicle" : STATE_HINT[f]}
                    onClick={() => setFilter(on && f !== "all" ? "all" : f)}
                    className={cn(
                      "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-full border px-2 text-xs font-medium transition-colors",
                      on ? "border-primary bg-primary-soft text-primary" : "border-border bg-background text-foreground hover:border-input hover:bg-muted"
                    )}
                  >
                    {f !== "all" && <span aria-hidden="true" className="inline-block size-1.5 rounded-full" style={{ background: STATE_COLORS[f] }} />}
                    {f === "all" ? "All" : STATE_LABEL[f]}
                    <span className={cn("font-bold tabular-nums", n === 0 && !on && "text-muted-foreground")}>{n}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div ref={listRef} className="relative min-h-0 flex-1 overflow-auto px-2 py-2" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
            {!loaded ? (
              <div className="grid gap-3 p-2" aria-busy="true" aria-label="Loading vehicles">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-12" />
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
              <div className="px-4 py-8 text-center">
                <p className="m-0 text-sm font-semibold">No vehicles in this view</p>
                <p className="m-0 text-xs text-muted-foreground">Vehicles appear here as soon as their status changes or they match your search.</p>
              </div>
            ) : (
              <ul className="relative m-0 list-none p-0" style={{ height: rows.length * ROW_H }} aria-label="Vehicles">
                {rows.slice(start, end).map((r, i) => {
                  const d = r.d;
                  const active = d.deviceId === selected;
                  const nm = splitName(r.name);
                  const detail = !d.location
                    ? "No position yet"
                    : r.state === "offline" && d.lastSeenAt
                      ? `Last signal ${ago(d.lastSeenAt, now)}`
                      : [d.vehicle?.licensePlate, r.state === "moving" ? u.fmtSpeed(d.location.speedKph) : STATE_HINT[r.state], !d.vehicle && "No vehicle linked"].filter(Boolean).join(" · ");
                  return (
                    <li key={d.deviceId} className="absolute inset-x-0 py-0.5" style={{ top: (start + i) * ROW_H, height: ROW_H }}>
                      <button
                        type="button"
                        onClick={() => focus(d.deviceId)}
                        aria-pressed={active}
                        className={cn(
                          "flex h-full w-full cursor-pointer items-center gap-3 rounded-lg border-0 bg-transparent px-3 text-left transition-colors hover:bg-muted",
                          active && "bg-primary-soft shadow-[inset_0_0_0_1px_var(--color-primary)] hover:bg-primary-soft"
                        )}
                      >
                        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full" style={{ background: STATE_TINT[r.state], color: STATE_COLORS[r.state] }}>
                          {d.vehicle ? <VehicleTypeIcon type={d.vehicle.type} className="size-4" /> : <Cpu className="size-4" />}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="flex min-w-0 items-baseline gap-1.5">
                            <span className="truncate text-sm font-semibold">{nm.main}</span>
                            {nm.imei && <span className="shrink-0 text-xs tabular-nums text-muted-foreground" title={r.name}>{nm.imei}</span>}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">{detail}</span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <StatusBadge state={r.state} />
                          <span className="text-[11px] leading-4 tabular-nums text-muted-foreground">{d.lastSeenAt ? ago(d.lastSeenAt, now) : "No data yet"}</span>
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

  const vehicleCard = sel && !historyFor && (
    <section
      key={sel.deviceId}
      aria-label="Selected vehicle"
      className={cn(
        "absolute inset-x-3 z-[2] grid animate-in gap-3 rounded-xl border border-border bg-background p-4 shadow-pop",
        "bottom-[160px] md:inset-x-auto md:bottom-6 md:left-4 md:w-[360px]",
        sheetOpen && "hidden md:grid"
      )}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full" style={{ background: STATE_TINT[selState], color: STATE_COLORS[selState] }}>
          {sel.vehicle ? <VehicleTypeIcon type={sel.vehicle.type} className="size-5" /> : <Cpu className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 flex min-w-0 items-baseline gap-1.5 text-base font-semibold">
            <span className="truncate">{splitName(deviceLabel(sel)).main}</span>
            {splitName(deviceLabel(sel)).imei && <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground">{splitName(deviceLabel(sel)).imei}</span>}
          </h2>
          <p className="m-0 truncate text-xs text-muted-foreground">
            {sel.vehicle ? [VEHICLE_TYPE_LABEL[asVehicleType(sel.vehicle.type)], sel.vehicle.licensePlate].filter(Boolean).join(" · ") : "GPS tracker · no vehicle linked"}
          </p>
        </div>
        <StatusBadge state={selState} />
        <button
          type="button"
          aria-label="Close vehicle details"
          className="-mr-1 -mt-1 grid size-8 shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => setSelected(null)}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      {sel.location ? (
        <>
          <dl className="m-0 grid grid-cols-3 gap-2">
            <Stat label="Speed" value={u.fmtSpeed(sel.location.speedKph)} />
            <Stat label="Engine" value={sel.location.ignition === null ? "Unknown" : sel.location.ignition ? "On" : "Off"} />
            <Stat label="Heading" value={selState === "moving" ? (compass(sel.location.headingDeg) ?? "–") : "–"} />
          </dl>
          <div className="grid gap-1 text-xs text-muted-foreground">
            <span>
              Updated <span className="font-medium text-foreground">{ago(sel.location.recordedAt, now)}</span> · {time.dateTimeSec(sel.location.recordedAt)} {time.abbr(sel.location.recordedAt)}
            </span>
            <div className="flex items-center gap-1">
              <span className="sr-only">Last location: </span>
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
          </div>
        </>
      ) : (
        <p className="m-0 text-xs text-muted-foreground">This tracker hasn&apos;t reported a position yet.</p>
      )}
      <div className="flex gap-2">
        <Button
          size="md"
          className="min-w-0 flex-1"
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
        <Button
          size="md"
          variant="secondary"
          className="min-w-0 flex-1"
          onClick={() => {
            setHistoryFor(sel.deviceId);
            setSheetOpen(true);
          }}
        >
          <History /> History
        </Button>
        <Button size="md" variant="secondary" className="shrink-0 px-2.5" onClick={() => focus(sel.deviceId)} disabled={!sel.location} aria-label="Center on vehicle" title="Center on vehicle">
          <Crosshair />
        </Button>
        {canShare && sel.vehicle && (
          <Button size="md" variant="secondary" className="shrink-0 px-2.5" onClick={() => setSharing(true)} aria-label="Share live location" title="Share live location">
            <Share2 />
          </Button>
        )}
      </div>
    </section>
  );

  return (
    <div ref={shellRef} className="absolute inset-0 flex bg-canvas">
      <div className="relative order-2 min-w-0 flex-1">
        {/* maplibre's CSS sets position:relative on the map element, so size it via a wrapper. */}
        <div className="absolute inset-0">
          <div ref={mapDiv} className="h-full w-full" />
        </div>

        {/* Top bar: view tools on the left, base map on the right. */}
        <div className="pointer-events-none absolute inset-x-3 top-3 z-[1] flex flex-wrap items-start gap-2">
          <div className="pointer-events-auto flex flex-wrap gap-2">
            <Button
              size="md"
              variant="secondary"
              className="hidden border-0 shadow-pop md:inline-flex"
              aria-expanded={panelOpen}
              aria-label={panelOpen ? "Hide vehicle panel" : "Show vehicle panel"}
              title={panelOpen ? "Hide vehicle panel" : "Show vehicle panel"}
              onClick={() => setPanelOpen((v) => !v)}
            >
              {panelOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
            </Button>
            <Button size="md" variant="secondary" className="border-0 shadow-pop" onClick={() => fitFleet(true)} disabled={counts.all === 0}>
              <Maximize2 /> Fit all
            </Button>
            <Menu.Root>
              <Menu.Trigger asChild>
                <Button size="md" variant="secondary" className="border-0 shadow-pop data-[state=open]:bg-primary-soft data-[state=open]:text-primary">
                  <Layers /> Layers <ChevronDown className="!size-3.5" />
                </Button>
              </Menu.Trigger>
              <Menu.Portal container={shellRef.current ?? undefined}>
                <Menu.Content align="start" sideOffset={6} className="z-50 min-w-[220px] animate-in rounded-xl border border-border bg-background p-1.5 shadow-pop">
                  <Menu.Label className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Show on map</Menu.Label>
                  {(
                    [
                      ["Vehicle names", showLabels, setShowLabels],
                      ["Group nearby vehicles", clustered, setClustered],
                      ["Zones", showZones, setShowZones]
                    ] as const
                  ).map(([label, on, set]) => (
                    <Menu.CheckboxItem
                      key={label}
                      checked={on}
                      onCheckedChange={(v) => set(v === true)}
                      onSelect={(e) => e.preventDefault()}
                      className="flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-muted"
                    >
                      <span aria-hidden="true" className={cn("grid size-4 place-items-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
                        <Menu.ItemIndicator>
                          <Check className="size-3" strokeWidth={3} />
                        </Menu.ItemIndicator>
                      </span>
                      {label}
                    </Menu.CheckboxItem>
                  ))}
                </Menu.Content>
              </Menu.Portal>
            </Menu.Root>
          </div>
          <div className="flex-1" />
          <div role="radiogroup" aria-label="Map style" className="pointer-events-auto flex gap-0.5 rounded-lg bg-background p-1 shadow-pop">
            {MAP_STYLES.map((st) => {
              const on = mapStyle === st.id;
              return (
                <button
                  key={st.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => !on && switchStyle(st.id)}
                  className={cn(
                    "h-7 cursor-pointer rounded-md border-0 px-3 text-[13px] font-semibold transition-colors",
                    on ? "bg-primary text-primary-foreground" : "bg-transparent text-foreground hover:bg-muted"
                  )}
                >
                  {st.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right rail: zoom, north, my location, full screen. */}
        <div className="absolute right-3 top-1/2 z-[1] hidden -translate-y-1/2 flex-col gap-2 sm:flex">
          <div className="flex flex-col overflow-hidden rounded-lg shadow-pop">
            <button type="button" aria-label="Zoom in" title="Zoom in" className={cn(MAP_BTN, "border-b border-border")} onClick={() => map?.zoomIn()}>
              <Plus className="size-[18px]" aria-hidden="true" />
            </button>
            <button type="button" aria-label="Zoom out" title="Zoom out" className={MAP_BTN} onClick={() => map?.zoomOut()}>
              <Minus className="size-[18px]" aria-hidden="true" />
            </button>
          </div>
          <button type="button" aria-label="Reset bearing to north" title="Reset bearing to north" className={cn(MAP_BTN, "rounded-lg shadow-pop")} onClick={() => {
              map?.resetNorthPitch();
              if (is3d) {
                setIs3d(false);
                if (map) setBuildings3d(map, false, mapStyle === "dark");
              }
            }}>
            <Navigation2 className="size-[18px] fill-danger text-danger transition-transform" style={{ transform: `rotate(${-bearing}deg)` }} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-pressed={is3d}
            aria-label={is3d ? "Switch to 2D view" : "Switch to 3D view"}
            title={is3d ? "2D view" : "3D view with buildings"}
            className={cn(MAP_BTN, "rounded-lg text-[13px] font-bold shadow-pop", is3d && "bg-primary text-primary-foreground hover:bg-primary-hover")}
            onClick={toggle3d}
          >
            {is3d ? "2D" : <Box className="size-[18px]" aria-hidden="true" />}
          </button>
          <button type="button" aria-label="Show my location" title="Show my location" className={cn(MAP_BTN, "rounded-lg shadow-pop")} onClick={locateMe}>
            <Locate className="size-[18px]" aria-hidden="true" />
          </button>
          <button type="button" aria-label={fullscreen ? "Exit full screen" : "Full screen"} title={fullscreen ? "Exit full screen" : "Full screen"} className={cn(MAP_BTN, "rounded-lg shadow-pop")} onClick={toggleFullscreen}>
            {fullscreen ? <Shrink className="size-[18px]" aria-hidden="true" /> : <Expand className="size-[18px]" aria-hidden="true" />}
          </button>
        </div>

        {vehicleCard}

        {follow && sel && (
          <div className="pointer-events-none absolute inset-x-0 top-16 z-[1] flex justify-center">
            <span role="status" className="pointer-events-auto inline-flex animate-in items-center gap-2 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background shadow-pop">
              <LocateFixed className="size-3.5" aria-hidden="true" /> Following {deviceLabel(sel)}
              <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-xs font-medium text-background underline" onClick={() => setFollow(false)}>
                Stop
              </button>
            </span>
          </div>
        )}
        {mapError && (
          <div className="absolute inset-x-3 top-16 z-[1] md:right-16">
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
          "md:static md:order-1 md:h-auto md:w-[380px] md:shrink-0 md:rounded-none md:border-r md:border-t-0 md:shadow-none md:transition-none",
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
