"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { readMapIcons, useMapIcons } from "@/lib/map-icons";
import { DEFAULT_ORG_MAP_PREFS, type OrgMapPrefs } from "@/lib/org-map-prefs";
import { useAddress } from "@/lib/use-address";
import maplibregl, { type Map as MlMap, type Popup } from "maplibre-gl";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Box, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, Download, Expand, ExternalLink, Gauge, History, IdCard, KeyRound, Layers, Locate, LocateFixed, MapPin, Maximize2, Minus, Navigation2, PanelLeftClose, PanelLeftOpen, Phone, Plus, Radio, Satellite, Share2, Shrink, Truck, Wifi, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shapeRing } from "@rio-gps/core/geo";
import { SearchInput } from "@/components/app/search-input";
import { EmptyState } from "@/components/app/states";
import { Select } from "@/components/ui/input";
import { VehiclePicture, vehiclePictureSrc } from "@/components/app/vehicle-picture";
import { asVehicleType, VEHICLE_TYPE_LABEL } from "@/lib/schemas/vehicle";
import { OrderBadge, PlateTag, VinTag, yearMakeModel } from "@/components/app/vehicle-tags";
import { DriverAvatar } from "../drivers/drivers-view";
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
import { compass, csvSafe, deviceLabel, FALLBACK_VIEW, hasStaleFix, iconName, mapState, MAP_STATES, STATE_ORDER, stateBucket, type MapState } from "./fleet-model";
import { useFleetStream } from "./use-fleet-stream";

// Loaded on first use: most sessions never open history.
const HistoryPanel = dynamic(() => import("./history-panel").then((m) => m.HistoryPanel), { ssr: false });
const ShareDialog = dynamic(() => import("../vehicles/share-dialog").then((m) => m.ShareDialog), { ssr: false });

/** One list card: name/tags, driver/speed, address (up to two lines). */
const ROW_H = 92;
const STATE_LABEL: Record<MapState, string> = { moving: "Moving", idle: "Idling", stopped: "Stopped", parked: "Parked (unhooked)", offline: "Offline" };
const STATE_HINT: Record<MapState, string> = {
  moving: "Travelling",
  idle: "Engine on, not moving",
  stopped: "Parked, engine off",
  parked: "Unhooked, at last known spot",
  offline: "Tracker not reporting"
};
/** Badge grounds: the status colour's soft tint (text uses the status colour itself). */
/** Soft status fill that also works in dark mode (mixed with the page background). */
const tint = (c: string, pct = 26) => `color-mix(in srgb, ${c} ${pct}%, var(--color-background))`;
const STATE_TINT: Record<MapState, string> = { moving: tint("#0f5c2c"), idle: tint("#8f3d06"), stopped: tint("#9c1818"), parked: tint("#5a1fc0"), offline: tint("#6b7280") };
const PRIMARY = "#1d4ed8";
/** A status colour used as text or an icon: a touch darker on light pages, brighter in dark mode, so it always reads. */
const ink = (c: string) => `color-mix(in srgb, ${c} 62%, var(--color-foreground))`;
/** "45 min", "2 h 05 min", "2 d 8 h" (same as the phone app). */
function durationText(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  if (m >= 1440) return `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}
/** One of the four live facts under the speed: coloured like the phone app. */
function Fact({ icon: Icon, label, value, color }: { icon: typeof Truck; label: string; value: string; color: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 overflow-hidden rounded-lg border px-2 py-1.5" style={{ background: tint(color, 22), borderColor: tint(color, 45) }}>
      <Icon className="size-3.5 shrink-0" style={{ color: ink(color) }} aria-hidden="true" />
      <span className="flex min-w-0 flex-col">
        <span className="text-[10px] font-semibold leading-3 text-muted-foreground">{label}</span>
        <span className="truncate text-xs font-bold leading-4" style={{ color: ink(color) }}>{value}</span>
      </span>
    </div>
  );
}
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
    sub: hasStaleFix(d, now, offlineSeconds) ? "No GPS" : state === "moving" ? (fmtSpeed && d.location.speedKph !== null ? fmtSpeed(d.location.speedKph) : "") : SUB[state],
    id: d.deviceId,
    name: deviceLabel(d),
    state,
    type: d.vehicle ? asVehicleType(d.vehicle.type) : "other",
    lngLat: [d.location.longitude, d.location.latitude],
    heading: d.location.headingDeg
  };
}

/** stale: online, but the newest position is old, so no status is claimed ("No GPS", grey). */
function StatusBadge({ state, stale = false }: { state: MapState; stale?: boolean }) {
  const look: MapState = stale ? "offline" : state;
  return (
    <span className="inline-flex shrink-0 items-center rounded-full px-2 text-xs font-semibold leading-[18px]" style={{ background: STATE_TINT[look], color: ink(STATE_COLORS[look]) }}>
      {stale ? "No GPS" : STATE_BADGE[state]}
    </span>
  );
}

export interface VehicleInfo {
  vin: string | null;
  modelYear: number | null;
  make: string | null;
  model: string | null;
  sortOrder: number | null;
  plateRegion: string | null;
}

/** One vehicle in the list: name, plate/VIN, status, driver, speed and the full address. */
function ListRow({
  r,
  info,
  driver,
  active,
  now,
  speed,
  addresses,
  onClick
}: {
  r: { d: CurrentDeviceLocation; state: MapState; stale: boolean; name: string };
  info: VehicleInfo | undefined;
  driver: string | undefined;
  active: boolean;
  now: number;
  speed: string | null;
  addresses: boolean;
  onClick: () => void;
}) {
  const d = r.d;
  const nm = splitName(r.name);
  const loc = d.location;
  const address = useAddress(addresses && loc ? loc.latitude : null, addresses && loc ? loc.longitude : null, r.state === "moving");
  const look: MapState = r.stale ? "offline" : r.state;
  const where = !loc ? "No position yet" : address ? [address.line1, address.line2].filter(Boolean).join(", ") : `${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}`;
  const ymm = info ? yearMakeModel(info) : null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={ymm ?? undefined}
      className={cn(
        "relative grid h-full w-full cursor-pointer grid-cols-[44px_minmax(0,1fr)] items-start gap-2.5 overflow-hidden rounded-xl border-0 py-2 pl-3 pr-2.5 text-left transition-shadow",
        active ? "shadow-[inset_0_0_0_2px_var(--color-primary),0_6px_14px_-6px_rgb(29_78_216/0.5)]" : "shadow-[inset_0_0_0_1px_var(--card-ring)] hover:shadow-[inset_0_0_0_1.5px_var(--card-ring-hover)]"
      )}
      style={{
        backgroundImage: `linear-gradient(110deg, ${tint(STATE_COLORS[look], 14)} 0%, ${tint(STATE_COLORS[look], 34)} 100%)`,
        ["--card-ring" as string]: `color-mix(in srgb, ${STATE_COLORS[look]} 22%, transparent)`,
        ["--card-ring-hover" as string]: `color-mix(in srgb, ${STATE_COLORS[look]} 45%, transparent)`
      }}
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1" style={{ background: STATE_COLORS[look] }} />
      <span className="mt-0.5 grid justify-items-center gap-1">
        <VehiclePicture type={d.vehicle?.type} state={r.state} className="h-8 w-11 rounded-md bg-background/80" />
      </span>
      <span className="grid min-w-0 gap-[3px]">
        <span className="flex min-w-0 items-center gap-1 overflow-hidden">
          <span className="shrink-0 text-[13.5px] font-bold text-foreground">{nm.main}</span>
          <OrderBadge order={info?.sortOrder} />
          <PlateTag plate={d.vehicle?.licensePlate} className="bg-background/70" />
          <VinTag vin={info?.vin} short className="bg-background/70" />
          <span className="ml-auto shrink-0 pl-1 text-[11px] tabular-nums text-muted-foreground">{d.lastSeenAt ? ago(d.lastSeenAt, now).replace(/ ago$/, "") : "No data"}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-foreground">
          <span className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-background/85 px-1.5 text-[10.5px] font-bold" style={{ color: ink(STATE_COLORS[look]) }}>
            {r.stale ? "No GPS" : STATE_BADGE[r.state]}
            {speed ? ` · ${speed}` : ""}
          </span>
          {driver ? (
            <>
              <IdCard className="size-3 shrink-0 text-[#0f766e]" aria-hidden="true" />
              <span className="truncate font-semibold">{driver}</span>
            </>
          ) : (
            <span className="truncate text-muted-foreground">{d.vehicle ? "No driver" : "No vehicle linked"}</span>
          )}
        </span>
        <span className="flex min-w-0 items-start gap-1 text-[11.5px] leading-[15px] text-foreground/75">
          <MapPin className="mt-px size-3 shrink-0" style={{ color: STATE_COLORS[look] }} aria-hidden="true" />
          <span className="line-clamp-2 [overflow-wrap:anywhere]" title={address?.label ?? where}>
            {where}
          </span>
        </span>
      </span>
    </button>
  );
}

/** Up to this many vehicles, icons show at every zoom instead of dots and count bubbles. */
const SMALL_FLEET = 60;

export function LiveMap({
  offlineSeconds,
  groups = [],
  canShare = false,
  defaultStyle = "streets",
  addresses = false,
  platformAdmin = false,
  drivers = {},
  vehicleInfo = {},
  mapPrefs = DEFAULT_ORG_MAP_PREFS
}: {
  /** VIN, year/make/model and the company's list order of each vehicle (vehicle id → details). */
  vehicleInfo?: Record<string, VehicleInfo>;
  /** The company's map defaults (Settings → Map display). */
  mapPrefs?: OrgMapPrefs;
  /** Who drives each vehicle now (vehicle id → driver), from the Drivers page. */
  drivers?: Record<string, { name: string; phone: string | null }>;
  offlineSeconds: number;
  /** RIO staff (super admin): also sees tracker diagnostics and IMEIs. Customers see plain status. */
  platformAdmin?: boolean;
  /** The map look chosen in the platform console (Maps & addresses). */
  defaultStyle?: MapStyleId;
  /** Whether an address service is on: then the selected vehicle shows its street address. */
  addresses?: boolean;
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
  const icons = useMapIcons();
  useEffect(() => layer.current?.setIconPrefs(icons), [icons]);
    const hover = useRef<Popup | null>(null);
  const fitted = useRef(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<{ device: string; from: string; to: string } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [groupId, setGroupId] = useState("");
  const [sort, setSort] = useState<"order" | "status" | "name" | "recent" | "speed">("order");
  const [clustered, setClustered] = useState(mapPrefs.cluster);
  const [now, setNow] = useState(() => Date.now());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [showLabels, setShowLabels] = useState(mapPrefs.labels);
  const [showZones, setShowZones] = useState(mapPrefs.zones);
  const [showNearby, setShowNearby] = useState(mapPrefs.nearby);
  const showZonesRef = useRef(mapPrefs.zones);
  showZonesRef.current = showZones;
  const [follow, setFollow] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [mapStyle, setMapStyle] = useState<MapStyleId>(defaultStyle);
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
      const opening = !fitted.current;
      fitted.current = true;
      // Opening: one smooth flight from the wide view down onto the fleet (like the phone app);
      // afterwards "Fit all" is a short move.
      m.fitBounds(b, { padding: { top: 90, bottom: 70, left: 80, right: 90 }, maxZoom: 13, duration: opening ? 1800 : 600, essential: true });
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
    fl.setIconPrefs(readMapIcons());

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
      // Trip replay: the part already played (green) over the full track (blue), and the stops.
      if (!m.getSource("track-done")) {
        m.addSource("track-done", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: "track-done", type: "line", source: "track-done", paint: { "line-color": "#16a34a", "line-width": 4.5 }, layout: { "line-join": "round", "line-cap": "round" } });
      }
      if (!m.getSource("track-stops")) {
        m.addSource("track-stops", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: "track-stops", type: "circle", source: "track-stops", paint: { "circle-radius": 6, "circle-color": ["get", "color"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5 } });
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
    // /map?trips=<deviceId>: open that vehicle's trip history (last 24 hours).
    const tripsId = q.get("trips");
    if (tripsId) setTripsParam(tripsId);
  }, []);
  const [tripsParam, setTripsParam] = useState<string | null>(null);
  useEffect(() => {
    if (!tripsParam || !loaded) return;
    if (devices.current.has(tripsParam)) {
      setSelected(tripsParam);
      setHistoryFor(tripsParam);
    }
    setTripsParam(null);
  }, [tripsParam, loaded, devices, version]);
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
    const rows = [...devices.current.values()].map((d) => ({ d, state: mapState(d, now, offlineSeconds), stale: hasStaleFix(d, now, offlineSeconds), name: deviceLabel(d) }));
    const byName = (a: (typeof rows)[number], b: (typeof rows)[number]) => a.name.localeCompare(b.name, undefined, { numeric: true });
    const order = (r: (typeof rows)[number]) => (r.d.vehicle ? (vehicleInfo[r.d.vehicle.id]?.sortOrder ?? null) : null);
    const byStatus = (a: (typeof rows)[number], b: (typeof rows)[number]) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || byName(a, b);
    rows.sort(
      sort === "order"
        ? (a, b) => {
            // The company's numbered vehicles first (1, 2, …), then everyone else moving first.
            const oa = order(a);
            const ob = order(b);
            if (oa !== null || ob !== null) return oa === null ? 1 : ob === null ? -1 : oa - ob || byStatus(a, b);
            return byStatus(a, b);
          }
        : sort === "name"
        ? byName
        : sort === "recent"
          ? (a, b) => Date.parse(b.d.lastSeenAt ?? "1970-01-01") - Date.parse(a.d.lastSeenAt ?? "1970-01-01") || byName(a, b)
          : sort === "speed"
            ? (a, b) => (b.d.location?.speedKph ?? -1) - (a.d.location?.speedKph ?? -1) || byName(a, b)
            : byStatus
    );
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, now, offlineSeconds, sort, vehicleInfo]);
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
    () => scoped.filter((r) => (filter === "all" || stateBucket(r.state) === filter) && (!q || r.name.toLowerCase().includes(q) || (r.d.vehicle?.licensePlate ?? "").toLowerCase().includes(q) || (r.d.vehicle ? (drivers[r.d.vehicle.id]?.name ?? "") : "").toLowerCase().includes(q) || (r.d.vehicle ? (vehicleInfo[r.d.vehicle.id]?.vin ?? "") : "").toLowerCase().includes(q))),
    [scoped, filter, q, drivers, vehicleInfo]
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
  // A small fleet shows its vehicle icons at every zoom (no dots or count bubbles on the first view).
  const smallFleet = counts.all <= SMALL_FLEET;
  useEffect(() => {
    layer.current?.setSmallFleet(smallFleet);
  }, [smallFleet, map]);

  /** Download what the list shows right now (after search and filters) as a spreadsheet file. */
  const exportCsv = () => {
    const head = ["vehicle", "plate", "type", "status", `speed_${u.speed === "mph" ? "mph" : "kmh"}`, "ignition", "latitude", "longitude", "last_gps_fix", "time_zone"];
    const lines = rows.map((r) => {
      const l = r.d.location;
      return [
        r.name,
        r.d.vehicle?.licensePlate ?? "",
        r.d.vehicle ? VEHICLE_TYPE_LABEL[asVehicleType(r.d.vehicle.type)] : "",
        r.stale ? "No current GPS" : STATE_LABEL[r.state],
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
  const selStale = sel ? hasStaleFix(sel, now, offlineSeconds) : false;
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
    return window.matchMedia(WIDE).matches ? { top: 0, right: 0, bottom: 0, left: 480 } : { top: 0, right: 0, bottom: 480, left: 0 };
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
  // Trip replay: the moving marker is the vehicle itself (its Live 3D picture, turned to its
  // heading), not a generic arrow. Re-applied after a base-map switch, which drops our layers.
  useEffect(() => {
    const m = map;
    if (!m || !historyFor) return;
    const d = devices.current.get(historyFor);
    const id = iconName(d?.vehicle?.type, "moving", { style: "top", color: "status" });
    const apply = () => {
      if (!m.getLayer("track-pos")) return;
      m.setLayoutProperty("track-pos", "icon-image", m.hasImage(id) ? id : "veh-moving");
      m.setLayoutProperty("track-pos", "icon-size", m.hasImage(id) ? 0.6 : 1.15);
    };
    if (m.hasImage(id)) apply();
    else
      m.loadImage(`/fleet-art/map/icons/${id}.png`)
        .then((res) => {
          if (!m.hasImage(id)) m.addImage(id, res.data, { pixelRatio: 3 });
          apply();
        })
        .catch(() => undefined);
    m.on("style.load", apply);
    return () => {
      m.off("style.load", apply);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, historyFor, mapStyle]);

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
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <h1 className="m-0 text-base font-extrabold tracking-tight text-primary">Live map</h1>
        <span className="text-xs text-muted-foreground">
          {rows.length === counts.all ? `${counts.all}` : `${rows.length} of ${counts.all}`} vehicle{counts.all === 1 ? "" : "s"}
        </span>
        <span role="status" className={cn("ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold", conn === "live" ? "bg-success-soft text-success" : "bg-warning-soft text-warning")}>
          {conn === "live" ? <span aria-hidden="true" className="live-ping inline-block size-1.5 rounded-full bg-current" /> : <Radio className="size-3" aria-hidden="true" />} {connLabel}
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
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2 border-b border-border bg-gradient-to-b from-background to-canvas px-3 pb-2.5">
            <div className="flex min-w-0 gap-1.5">
              <div className="min-w-0 flex-1">
                <SearchInput value={search} onChange={setSearch} placeholder="Vehicle, driver, plate, VIN" label="Search vehicles" debounceMs={150} className="sm:w-full" />
              </div>
              <Select aria-label="Sort vehicles" title="Sort" className="w-[6.5rem] shrink-0 px-2 text-xs" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                <option value="order">Your order</option>
                <option value="status">Moving first</option>
                <option value="name">Name</option>
                <option value="recent">Latest update</option>
                <option value="speed">Speed</option>
              </Select>
              <Button size="md" variant="secondary" className="shrink-0 px-2.5" onClick={exportCsv} disabled={rows.length === 0} aria-label="Export this list as CSV" title="Export this list as CSV">
                <Download />
              </Button>
            </div>
            <div role="radiogroup" aria-label="Filter by status" className="grid grid-cols-[repeat(5,minmax(0,1fr))] gap-1">
              {(["all", ...MAP_STATES] as Filter[]).map((f) => {
                const on = filter === f;
                const n = counts[f];
                const color = f === "all" ? PRIMARY : STATE_COLORS[f];
                return (
                  <button
                    key={f}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    title={f === "all" ? "Every vehicle" : STATE_HINT[f]}
                    onClick={() => setFilter(f)}
                    className={cn("grid cursor-pointer justify-items-center gap-px rounded-lg border-0 px-0.5 py-1 transition-shadow", on ? "text-white" : "text-foreground hover:brightness-95")}
                    style={
                      on
                        ? { background: `linear-gradient(135deg, ${f === "all" ? "#1849c6" : color}, ${f === "all" ? "#0a2463" : ink(color)})`, boxShadow: `0 4px 10px -4px ${color}` }
                        : { background: tint(color, 12), boxShadow: `inset 0 0 0 1px ${tint(color, 40)}` }
                    }
                  >
                    <span className="text-[15px] font-extrabold leading-[18px] tabular-nums" style={on ? undefined : { color: f === "all" ? undefined : ink(color) }}>
                      {n}
                    </span>
                    <span className="flex items-center gap-1 text-[10.5px] font-semibold">
                      {f !== "all" && !on && <span aria-hidden="true" className="inline-block size-1.5 rounded-full" style={{ background: color }} />}
                      {f === "all" ? "All" : STATE_LABEL[f]}
                    </span>
                  </button>
                );
              })}
            </div>
            {groups.length > 0 && (
              <div role="radiogroup" aria-label="Filter by group" className="flex flex-wrap items-center gap-1">
                <span className="mr-0.5 inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                  <Layers className="size-3" aria-hidden="true" /> Groups
                </span>
                {[{ id: "", name: "All", n: all.length }, ...groups.map((g) => ({ id: g.id, name: g.name, n: g.vehicleIds.length }))].map((g) => {
                  const on = groupId === g.id;
                  return (
                    <button
                      key={g.id || "all"}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setGroupId(g.id)}
                      className={cn(
                        "inline-flex h-6 cursor-pointer items-center gap-1 rounded-md border-0 px-2 text-[11.5px] font-semibold transition-colors",
                        on ? "bg-primary text-primary-foreground" : "bg-background text-foreground shadow-[inset_0_0_0_1px_var(--color-border)] hover:bg-muted"
                      )}
                    >
                      {g.name}
                      <span className={on ? "opacity-80" : "text-muted-foreground"}>{g.n}</span>
                    </button>
                  );
                })}
                <Link href="/vehicles" title="Manage groups" aria-label="Manage groups" className="grid size-6 place-items-center rounded-md bg-background text-primary no-underline shadow-[inset_0_0_0_1px_var(--color-border)] hover:bg-muted">
                  <Plus className="size-3" aria-hidden="true" />
                </Link>
              </div>
            )}
          </div>

          <div ref={listRef} className="relative min-h-0 flex-1 overflow-auto bg-canvas px-2 py-1.5" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
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
                  return (
                    <li key={d.deviceId} className="absolute inset-x-0 py-[3px]" style={{ top: (start + i) * ROW_H, height: ROW_H }}>
                      <ListRow
                        r={r}
                        info={d.vehicle ? vehicleInfo[d.vehicle.id] : undefined}
                        driver={d.vehicle ? drivers[d.vehicle.id]?.name : undefined}
                        active={d.deviceId === selected}
                        now={now}
                        addresses={addresses}
                        speed={r.state === "moving" && !r.stale && d.location ? u.fmtSpeed(d.location.speedKph) : null}
                        onClick={() => focus(d.deviceId)}
                      />
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

  // Previous / next vehicle in the list order (Life360-style): edge chips, the card's arrows and ← / →.
  const located = rows.filter((r) => r.d.location);
  const selIdx = located.findIndex((r) => r.d.deviceId === selected);
  const neighbour = (by: -1 | 1) => (selIdx < 0 || located.length < 2 ? undefined : located[(selIdx + by + located.length) % located.length]);
  const stepTo = (by: -1 | 1) => {
    const n = neighbour(by);
    if (n) focus(n.d.deviceId);
  };
  const touchX = useRef<number | null>(null);
  const stepRef = useRef(stepTo);
  stepRef.current = stepTo;
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "ArrowLeft") stepRef.current(-1);
      if (e.key === "ArrowRight") stepRef.current(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);
  // Redraw the edge hints while the map moves (one update per frame at most).
  const [, setViewTick] = useState(0);
  useEffect(() => {
    const m = map;
    if (!m) return;
    let raf = 0;
    const onMove = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setViewTick((t) => t + 1);
      });
    };
    m.on("move", onMove);
    return () => {
      m.off("move", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [map]);
  /**
   * Nearby vehicles, the way the phone app shows them: every vehicle just off the screen gets a round
   * chip on the left or right edge of the map (the side it is on, at the height it is), with its 3D
   * picture in a ring of its status colour, a small arrow pointing at it and its name. Up to 6, nearest
   * first. Zoomed out to a continent everything is on screen anyway, so none are shown.
   */
  const nearbyChips = () => {
    const m = mapRef.current;
    if (!m || historyFor) return null;
    const box = m.getContainer();
    const w = box.clientWidth;
    const h = box.clientHeight;
    const bounds = m.getBounds();
    if (bounds.getEast() - bounds.getWest() >= 60 || bounds.getNorth() - bounds.getSouth() >= 40) return null;
    const cx = w / 2;
    const cy = h / 2;
    const top = 74;
    const bottom = h - 48;
    const card = sel && w >= 768 ? { right: 500, top: h - 440 } : null;
    const GAP = 70;
    const off = located
      .filter((r) => r.d.deviceId !== selected)
      .map((r) => ({ r, p: m.project([r.d.location!.longitude, r.d.location!.latitude]) }))
      .filter(({ p }) => p.x < 0 || p.x > w || p.y < 0 || p.y > h)
      .map((o) => ({ ...o, dist: Math.hypot(o.p.x - cx, o.p.y - cy) }))
      .sort((x, y) => x.dist - y.dist)
      .slice(0, 6);
    const lay = (side: "left" | "right") => {
      const list = off
        .filter(({ p }) => (side === "left" ? p.x < cx : p.x >= cx))
        .map((o) => ({ ...o, y: Math.min(Math.max(o.p.y, top), bottom - GAP) }))
        .sort((x, y) => x.y - y.y);
      for (let i = 1; i < list.length; i++) if (list[i]!.y - list[i - 1]!.y < GAP) list[i]!.y = list[i - 1]!.y + GAP;
      const limit = side === "left" && card ? card.top - GAP : bottom - GAP + 10;
      return list.filter((o) => o.y <= limit).map((o) => ({ ...o, side }));
    };
    return [...lay("left"), ...lay("right")].map(({ r, p, y, side }) => {
      const x = side === "left" ? 40 : w - 104;
      const deg = (Math.atan2(p.x - x, -(p.y - y)) * 180) / Math.PI;
      const color = STATE_COLORS[r.state];
      const src = vehiclePictureSrc(r.d.vehicle?.type, r.state);
      const name = splitName(r.name).main;
      return (
        <button
          key={`near-${r.d.deviceId}`}
          type="button"
          onClick={() => focus(r.d.deviceId)}
          title={`${name}: ${STATE_BADGE[r.state]}. Show on the map`}
          aria-label={`${name}, ${STATE_BADGE[r.state]}. Show on the map`}
          className="group absolute z-[1] flex -translate-x-1/2 animate-in cursor-pointer flex-col items-center gap-1 border-0 bg-transparent p-0"
          style={{ left: x, top: y }}
        >
          <span className="relative grid size-[50px] place-items-center">
            <span aria-hidden="true" className="absolute inset-[-8px] flex justify-center transition-transform" style={{ transform: `rotate(${deg}deg)` }}>
              <span className="h-0 w-0 border-x-[6px] border-b-[8px] border-x-transparent" style={{ borderBottomColor: color }} />
            </span>
            <span
              className="grid size-[50px] place-items-center overflow-hidden rounded-full border-[3px] bg-background shadow-pop transition-transform group-hover:scale-110"
              style={{ borderColor: color, background: `radial-gradient(circle at 50% 35%, var(--color-background) 40%, ${tint(color, 30)} 100%)` }}
            >
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element -- small static picture from /public
                <img src={src} alt="" className="w-[40px] object-contain" />
              ) : (
                <Truck className="size-5" style={{ color: ink(color) }} aria-hidden="true" />
              )}
            </span>
          </span>
          <span className="max-w-[112px] truncate rounded-full bg-background px-2 py-0.5 text-[11px] font-bold leading-4 text-foreground shadow-card">{name}</span>
          <span className="-mt-0.5 rounded-full px-1.5 text-[10px] font-semibold leading-4" style={{ background: tint(color, 30), color: ink(color) }}>
            {r.state === "moving" && r.d.location ? u.fmtSpeed(r.d.location.speedKph) : STATE_BADGE[r.state]}
          </span>
        </button>
      );
    });
  };

  const address = useAddress(addresses && sel?.location ? sel.location.latitude : null, addresses && sel?.location ? sel.location.longitude : null, selState === "moving");

  const selInfo = sel?.vehicle ? vehicleInfo[sel.vehicle.id] : undefined;
  const selYmm = selInfo ? yearMakeModel(selInfo) : null;
  const selDriver = sel?.vehicle ? drivers[sel.vehicle.id] : undefined;
  const canStep = located.length > 1 && selIdx >= 0;
  const vehicleHref = sel?.vehicle ? `/vehicles/${sel.vehicle.id}` : null;
  const vehicleCard = sel && !historyFor && (
    <div className={cn("absolute inset-x-3 z-[2] bottom-[160px] md:inset-x-auto md:bottom-5 md:left-4 md:w-[468px]", sheetOpen && "hidden md:block")}>
      {/* Previous / next vehicle: round arrows on the card's edges (also ← / → keys and swipe on phones). */}
      {canStep && (
        <>
          <button type="button" aria-label="Previous vehicle" title="Previous vehicle (←)" onClick={() => stepTo(-1)} className="absolute left-0 top-1/2 z-[3] hidden size-9 -translate-y-1/2 cursor-pointer place-items-center rounded-full border-0 bg-background text-primary shadow-pop hover:bg-primary-soft md:grid">
            <ChevronLeft className="size-5" aria-hidden="true" />
          </button>
          <button type="button" aria-label="Next vehicle" title="Next vehicle (→)" onClick={() => stepTo(1)} className="absolute right-0 top-1/2 z-[3] hidden size-9 -translate-y-1/2 cursor-pointer place-items-center rounded-full border-0 bg-background text-primary shadow-pop hover:bg-primary-soft md:grid">
            <ChevronRight className="size-5" aria-hidden="true" />
          </button>
        </>
      )}
      <section
        key={sel.deviceId}
        aria-label="Selected vehicle"
        className="relative grid animate-in grid-cols-[minmax(0,1fr)] gap-2.5 overflow-hidden rounded-2xl border border-border bg-background p-3 pl-4 shadow-pop md:mx-11"
        style={{ backgroundImage: `linear-gradient(160deg, ${tint(STATE_COLORS[selState], 8)} 0%, ${tint(STATE_COLORS[selState], 36)} 100%)` }}
        onTouchStart={(e) => {
          touchX.current = e.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(e) => {
          const x0 = touchX.current;
          const x1 = e.changedTouches[0]?.clientX;
          touchX.current = null;
          if (x0 != null && x1 != null && Math.abs(x1 - x0) > 60) stepTo(x1 < x0 ? 1 : -1);
        }}
      >
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1.5" style={{ background: STATE_COLORS[selState] }} />
        <button
          type="button"
          aria-label="Close vehicle details"
          className="absolute right-2 top-2 z-[1] grid size-7 cursor-pointer place-items-center rounded-md border-0 bg-background/70 text-muted-foreground hover:bg-background hover:text-foreground"
          onClick={() => setSelected(null)}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
        {/* Header: opens the vehicle's full page. */}
        {(() => {
          const head = (
            <>
              <VehiclePicture type={sel.vehicle?.type} state={selState ?? undefined} className="h-12 w-16 shrink-0 rounded-xl bg-background" />
              <span className="grid min-w-0 flex-1 gap-1">
                <span className="flex min-w-0 items-baseline gap-2 pr-7">
                  <span className="shrink-0 text-[17px] font-extrabold text-primary">{splitName(deviceLabel(sel)).main}</span>
                  {platformAdmin && splitName(deviceLabel(sel)).imei && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{splitName(deviceLabel(sel)).imei}</span>}
                  {selYmm && <span className="truncate text-xs text-muted-foreground">{selYmm}</span>}
                </span>
                <span className="flex min-w-0 flex-wrap items-center gap-1">
                  <StatusBadge state={selState} stale={selStale} />
                  {sel.vehicle ? (
                    <>
                      <PlateTag plate={sel.vehicle.licensePlate} className="bg-background/80" />
                      <VinTag vin={selInfo?.vin} short className="bg-background/80" />
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">GPS tracker · no vehicle linked</span>
                  )}
                </span>
              </span>
            </>
          );
          return vehicleHref ? (
            <Link href={vehicleHref} title="Open the vehicle page" className="-m-1 flex items-center gap-3 rounded-xl p-1 text-foreground no-underline hover:bg-background/60">
              {head}
            </Link>
          ) : (
            <div className="flex items-center gap-3">{head}</div>
          );
        })()}
        {sel.vehicle && (
          <div className="flex items-center gap-2 rounded-xl bg-background/75 px-2.5 py-1.5">
            {selDriver ? (
              <>
                <DriverAvatar name={selDriver.name} className="size-7 text-[10px]" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{selDriver.name}</span>
                {selDriver.phone && (
                  <a href={`tel:${selDriver.phone}`} title={`Call ${selDriver.phone}`} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-success-soft px-2 text-xs font-semibold text-success no-underline hover:brightness-95">
                    <Phone className="size-3" aria-hidden="true" /> Call
                  </a>
                )}
              </>
            ) : (
              <Link href="/drivers" className="text-xs text-muted-foreground no-underline hover:text-primary hover:underline">
                <IdCard className="mr-1 inline size-3.5 align-[-2px]" aria-hidden="true" />
                No driver · assign one
              </Link>
            )}
          </div>
        )}
        {sel.location ? (
          <>
            {selStale ? (
              // Reporting, but the newest position is old: never show its speed as current.
              <div className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ background: tint(STATE_COLORS.idle) }}>
                <Satellite className="size-5 shrink-0" style={{ color: ink(STATE_COLORS.idle) }} aria-hidden="true" />
                <div className="min-w-0">
                  <p className="m-0 text-sm font-bold">{platformAdmin ? "No current GPS position" : "Location may be out of date"}</p>
                  <p className="m-0 text-xs text-muted-foreground">
                    {platformAdmin
                      ? `The tracker is online, but its newest position is ${durationText((now - Date.parse(sel.location.recordedAt)) / 60000)} old. It may be uploading stored records or have no GPS signal.`
                      : `Last known position, ${durationText((now - Date.parse(sel.location.recordedAt)) / 60000)} ago.`}
                  </p>
                </div>
              </div>
            ) : selState === "offline" || selState === "parked" ? (
              // Not reporting: say so plainly instead of showing a speed that is no longer true.
              <div className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ background: tint(STATE_COLORS.idle) }}>
                <Radio className="size-5 shrink-0" style={{ color: ink(STATE_COLORS.idle) }} aria-hidden="true" />
                <div className="min-w-0">
                  <p className="m-0 text-sm font-bold">{sel.lastSeenAt ? `Not reporting for ${durationText((now - Date.parse(sel.lastSeenAt)) / 60000)}` : "No report yet"}</p>
                  <p className="m-0 text-xs text-muted-foreground">
                    {platformAdmin
                      ? selState === "parked"
                        ? "Unhooked trailer: it reports only on its own battery."
                        : "Usually no power or no mobile signal."
                      : selState === "parked"
                        ? "Parked trailer. Its position updates when it moves."
                        : "Showing its last known position."}
                  </p>
                </div>
              </div>
            ) : null}
            <div className={cn("grid gap-1.5", platformAdmin ? "grid-cols-[repeat(4,minmax(0,1fr))]" : "grid-cols-[repeat(3,minmax(0,1fr))]")}>
              <Fact icon={Gauge} label="Speed" value={selStale || selState === "offline" || selState === "parked" ? "—" : u.fmtSpeed(selState === "moving" ? sel.location.speedKph : 0)} color={selState === "moving" && !selStale ? STATE_COLORS.moving : STATE_COLORS.offline} />
              <Fact icon={KeyRound} label="Ignition" value={selStale || sel.location.ignition === null ? "Unknown" : sel.location.ignition ? "On" : "Off"} color={selStale ? STATE_COLORS.offline : sel.location.ignition === false ? STATE_COLORS.stopped : sel.location.ignition ? STATE_COLORS.moving : STATE_COLORS.offline} />
              <Fact icon={Satellite} label={platformAdmin ? "GPS" : "Updated"} value={now - Date.parse(sel.location.recordedAt) < 120_000 ? "Live" : ago(sel.location.recordedAt, now)} color={now - Date.parse(sel.location.recordedAt) < 120_000 ? PRIMARY : STATE_COLORS.idle} />
              {platformAdmin && <Fact icon={Wifi} label="Tracker" value={selState === "offline" || selState === "parked" ? "Offline" : "Online"} color={selState === "offline" || selState === "parked" ? STATE_COLORS.offline : STATE_COLORS.moving} />}
            </div>
            <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: tint(PRIMARY, 16) }}>
              <MapPin className="size-4 shrink-0" style={{ color: ink(PRIMARY) }} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <span className="sr-only">Last location: </span>
                <p className="m-0 text-sm font-bold leading-5 [overflow-wrap:anywhere]" title={address?.label}>
                  {address ? address.line1 : `${sel.location.latitude.toFixed(5)}, ${sel.location.longitude.toFixed(5)}`}
                </p>
                <p className="m-0 text-xs text-foreground/80" title={`${time.dateTimeSec(sel.location.recordedAt)} ${time.abbr(sel.location.recordedAt)}`}>
                  {[address?.line2, selState === "moving" && !selStale && compass(sel.location.headingDeg) ? `heading ${compass(sel.location.headingDeg)}` : null].filter(Boolean).join(" · ") || `Updated ${ago(sel.location.recordedAt, now)}`}
                </p>
              </div>
              <button
                type="button"
                aria-label={address ? "Copy address" : "Copy coordinates"}
                title={address ? "Copy address" : "Copy coordinates"}
                className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg border-0 bg-background text-primary shadow-card hover:bg-muted"
                onClick={() => {
                  const text = address?.label ?? `${sel.location!.latitude.toFixed(6)}, ${sel.location!.longitude.toFixed(6)}`;
                  navigator.clipboard.writeText(text).then(
                    () => toast.success(address ? "Address copied." : "Coordinates copied."),
                    () => toast.error("Couldn't copy. Select the text and copy it.")
                  );
                }}
              >
                <Copy className="size-3.5" aria-hidden="true" />
              </button>
              <a
                className="grid size-8 shrink-0 place-items-center rounded-lg bg-background text-primary shadow-card hover:bg-muted"
                href={`https://www.google.com/maps/search/?api=1&query=${sel.location.latitude.toFixed(6)},${sel.location.longitude.toFixed(6)}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open in Google Maps"
                title="Open in Google Maps"
              >
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            </div>
          </>
        ) : (
          <p className="m-0 text-xs text-muted-foreground">{platformAdmin ? "This tracker hasn't reported a position yet." : "No position yet. It appears here as soon as the vehicle reports."}</p>
        )}
        <div className="flex gap-1.5">
          {vehicleHref && (
            <Button asChild size="md" className="min-w-0 flex-1">
              <Link href={vehicleHref}>
                <Truck /> Vehicle details
              </Link>
            </Button>
          )}
          <Button
            size="md"
            variant="secondary"
            className="min-w-0 flex-1"
            onClick={() => {
              setHistoryFor(sel.deviceId);
              setSheetOpen(true);
            }}
          >
            <History /> Trip history
          </Button>
          <Button
            size="md"
            variant={follow ? "primary" : "secondary"}
            className="shrink-0 px-2.5"
            aria-pressed={follow}
            disabled={!sel.location}
            aria-label={follow ? "Stop following" : "Follow on the map"}
            title={follow ? "Following: click to stop" : "Follow on the map"}
            onClick={() => {
              if (!follow) focus(sel.deviceId);
              setFollow((v) => !v);
            }}
          >
            <LocateFixed />
          </Button>
          {canShare && sel.vehicle && (
            <Button size="md" variant="secondary" className="shrink-0 px-2.5" onClick={() => setSharing(true)} aria-label="Share live location" title="Share live location">
              <Share2 />
            </Button>
          )}
        </div>
      </section>
      {canStep && (
        <div aria-hidden="true" className="mt-2 hidden items-center justify-center gap-1 md:flex">
          {located.length <= 12 ? (
            located.map((r, i) => <span key={r.d.deviceId} className={cn("h-1.5 rounded-full transition-all", i === selIdx ? "w-4" : "w-1.5 bg-foreground/25")} style={i === selIdx ? { background: STATE_COLORS[selState] } : undefined} />)
          ) : null}
          <span className="ml-1.5 rounded-full bg-background/90 px-2 text-[11px] font-bold text-foreground shadow-card">
            {selIdx + 1} of {located.length}
          </span>
        </div>
      )}
    </div>
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
                      ["Nearby vehicle chips", showNearby, setShowNearby],
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
        {showNearby && nearbyChips()}

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
          "md:static md:order-1 md:h-auto md:w-[370px] md:shrink-0 md:rounded-none md:border-r md:border-t-0 md:shadow-none md:transition-none",
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
