"use client";
import "maplibre-gl/dist/maplibre-gl.css";
/**
 * Loads map: every active load on one map, coloured by what it is doing (moving, stopped,
 * driver paused, no signal), with the ones needing attention ringed in red. The side panel
 * (a bottom sheet on phones) filters and lists them; picking one shows its stops, the trail
 * so far, a dashed line to its next stop and a summary card. Refreshes every 20 seconds
 * while the tab is visible.
 */
import { circleRing } from "@rio-gps/core/geo";
import { AlertTriangle, ArrowRight, ChevronUp, ExternalLink, List, Maximize2, Package, PackagePlus, PanelLeftClose, PanelLeftOpen, Phone, Truck, X } from "lucide-react";
import maplibregl, { type GeoJSONSource, type Map as MlMap, type MapLayerMouseEvent, type Marker } from "maplibre-gl";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pin } from "@/components/app/load-map";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { useTime } from "@/components/app/time-context";
import { useUnits } from "@/components/app/units-context";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import { fmtDistanceM, LOAD_STATUS_META, loadMotion, MOTION_META, needsAttention, shortPlace, type LoadMotion } from "@/lib/load-meta";
import type { LoadDetailDto, LoadSummaryDto } from "@/lib/loads";

const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const REFRESH_MS = 20_000;
const CLUSTER_MAX_ZOOM = 7;
const FALLBACK = { center: [-85, 43] as [number, number], zoom: 4 };

type Filter = "all" | "moving" | "stopped" | "attention" | "waiting";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "moving", label: "Moving" },
  { value: "stopped", label: "Stopped" },
  { value: "attention", label: "Needs attention" },
  { value: "waiting", label: "Waiting" }
];

interface Row {
  load: LoadSummaryDto;
  motion: LoadMotion;
  attention: boolean;
}

function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

const lane = (l: LoadSummaryDto) => `${shortPlace(l.pickup.name, l.pickup.address)} → ${shortPlace(l.delivery.name, l.delivery.address)}`;

export function LoadsMap({ initial, canWrite }: { initial: LoadSummaryDto[]; canWrite: boolean }) {
  const t = useTime();
  const u = useUnits();
  const [loads, setLoads] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<LoadDetailDto | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const mapDiv = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const stopMarkers = useRef<Marker[]>([]);
  const fitted = useRef(false);

  // ---- data ----
  const refresh = useCallback(async () => {
    try {
      setLoads((await api<{ loads: LoadSummaryDto[] }>("/api/loads?filter=active")).loads);
      setNow(Date.now());
      setRefreshError(false);
    } catch {
      setRefreshError(true);
    }
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, REFRESH_MS);
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      clearInterval(timer);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const rows: Row[] = useMemo(
    () =>
      loads
        .map((load) => ({ load, motion: loadMotion(load, now), attention: needsAttention(load) }))
        // Problems first, then moving, stopped, waiting; newest first within a group.
        .sort((a, b) => Number(b.attention) - Number(a.attention) || MOTION_META[a.motion].order - MOTION_META[b.motion].order || b.load.createdAt.localeCompare(a.load.createdAt)),
    [loads, now]
  );
  const counts = useMemo(
    () => ({
      all: rows.length,
      moving: rows.filter((r) => r.motion === "moving").length,
      stopped: rows.filter((r) => r.motion === "stopped").length,
      attention: rows.filter((r) => r.attention).length,
      waiting: rows.filter((r) => r.motion === "waiting").length
    }),
    [rows]
  );
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "attention" ? !r.attention : filter !== "all" && r.motion !== filter) return false;
      if (!s) return true;
      const l = r.load;
      return [l.reference, l.driverName, l.driverPhone, l.carrierName, l.vehicle?.name, l.pickup.address, l.delivery.address, l.pickup.name, l.delivery.name].some((v) => v?.toLowerCase().includes(s));
    });
  }, [rows, filter, q]);
  const sel = rows.find((r) => r.load.id === selected) ?? null;

  // Selected load's trail (and fresh detail) — refetched when it changes or the list refreshes.
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let live = true;
    api<LoadDetailDto>(`/api/loads/${selected}`)
      .then((d) => live && setDetail(d))
      .catch(() => live && setDetail(null));
    return () => {
      live = false;
    };
  }, [selected, loads]);

  // ---- map ----
  useEffect(() => {
    if (!mapDiv.current || map.current) return;
    const m = new maplibregl.Map({ container: mapDiv.current, style: STYLE_URL, center: FALLBACK.center, zoom: FALLBACK.zoom, attributionControl: { compact: true } });
    m.getCanvas().setAttribute("aria-label", "Map of active loads. Use the load list for keyboard access.");
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    m.on("styleimagemissing", (e) => {
      if (!m.hasImage(e.id)) m.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
    m.on("load", () => {
      // Selected load: arrival circles, trail, dashed line to the next stop (under the dots).
      m.addSource("sel-stops", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "sel-stops-fill", type: "fill", source: "sel-stops", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.12 } });
      m.addSource("sel-trail", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "sel-trail", type: "line", source: "sel-trail", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#1d4fb8", "line-width": 3.5, "line-opacity": 0.8 } });
      m.addSource("sel-next", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "sel-next", type: "line", source: "sel-next", paint: { "line-color": "#1d4fb8", "line-width": 2, "line-dasharray": [2, 2], "line-opacity": 0.7 } });

      m.addSource("loads", { type: "geojson", data: { type: "FeatureCollection", features: [] }, cluster: true, clusterMaxZoom: CLUSTER_MAX_ZOOM, clusterRadius: 40, clusterProperties: { attention: ["+", ["get", "attentionN"]] } });
      m.addLayer({ id: "clusters", type: "circle", source: "loads", filter: ["has", "point_count"], paint: { "circle-color": "#0a2463", "circle-radius": ["step", ["get", "point_count"], 15, 10, 19, 50, 24], "circle-stroke-width": ["case", [">", ["get", "attention"], 0], 3, 2], "circle-stroke-color": ["case", [">", ["get", "attention"], 0], "#d81e2c", "#ffffff"] } });
      m.addLayer({ id: "load-ring", type: "circle", source: "loads", filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "attention"], true]], paint: { "circle-radius": 13, "circle-color": "rgba(216,30,44,0.18)", "circle-stroke-color": "#d81e2c", "circle-stroke-width": 2 } });
      m.addLayer({ id: "load-sel", type: "circle", source: "loads", filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "selected"], true]], paint: { "circle-radius": 16, "circle-color": "rgba(29,79,184,0.15)", "circle-stroke-color": "#1d4fb8", "circle-stroke-width": 2 } });
      m.addLayer({ id: "load-dot", type: "circle", source: "loads", filter: ["!", ["has", "point_count"]], paint: { "circle-radius": 8, "circle-color": ["get", "color"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5 } });
      if (m.getStyle().glyphs) {
        m.addLayer({ id: "cluster-count", type: "symbol", source: "loads", filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12, "text-font": ["Noto Sans Bold"] }, paint: { "text-color": "#ffffff" } });
        m.addLayer({
          id: "load-label",
          type: "symbol",
          source: "loads",
          filter: ["!", ["has", "point_count"]],
          minzoom: 5,
          layout: { "text-field": ["get", "label"], "text-size": 12, "text-font": ["Noto Sans Bold"], "text-offset": [0, 1.3], "text-anchor": "top", "text-optional": true },
          paint: { "text-color": "#0a2463", "text-halo-color": "#ffffff", "text-halo-width": 1.6 }
        });
      }
      const pick = (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) select(id, false);
      };
      m.on("click", "load-dot", pick);
      m.on("click", "clusters", (e) => {
        const f = e.features?.[0];
        const cid = f?.properties?.cluster_id as number | undefined;
        if (f && cid !== undefined)
          void (m.getSource("loads") as GeoJSONSource).getClusterExpansionZoom(cid).then((z) => m.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: z + 0.5 }));
      });
      for (const l of ["load-dot", "clusters"]) {
        m.on("mouseenter", l, () => (m.getCanvas().style.cursor = "pointer"));
        m.on("mouseleave", l, () => (m.getCanvas().style.cursor = ""));
      }
      setLoaded(true);
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dots.
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    const features: GeoJSON.Feature[] = rows
      .filter((r) => r.load.lastPosition && (filter === "all" || (filter === "attention" ? r.attention : r.motion === filter)))
      .map((r) => ({
        type: "Feature",
        properties: { id: r.load.id, label: r.load.reference, color: MOTION_META[r.motion].color, attention: r.attention, attentionN: r.attention ? 1 : 0, selected: r.load.id === selected },
        geometry: { type: "Point", coordinates: [r.load.lastPosition!.longitude, r.load.lastPosition!.latitude] }
      }));
    (m.getSource("loads") as GeoJSONSource).setData({ type: "FeatureCollection", features });
  }, [rows, loaded, filter, selected]);

  const fitAll = useCallback(
    (animate: boolean) => {
      const m = map.current;
      const pts = rows.filter((r) => r.load.lastPosition).map((r) => [r.load.lastPosition!.longitude, r.load.lastPosition!.latitude] as [number, number]);
      if (!m || pts.length === 0) return;
      const b = new maplibregl.LngLatBounds();
      pts.forEach((p) => b.extend(p));
      m.fitBounds(b, { padding: 70, maxZoom: 11, duration: animate ? 600 : 0 });
    },
    [rows]
  );
  useEffect(() => {
    if (loaded && !fitted.current && rows.some((r) => r.load.lastPosition)) {
      fitted.current = true;
      fitAll(false);
    }
  }, [loaded, rows, fitAll]);

  // Selected load overlay: stops, trail, dashed line to the next stop.
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    stopMarkers.current.forEach((mk) => mk.remove());
    stopMarkers.current = [];
    const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    const s = sel?.load;
    if (!s) {
      for (const id of ["sel-stops", "sel-trail", "sel-next"]) (m.getSource(id) as GeoJSONSource).setData(empty);
      return;
    }
    const ring = (st: { latitude: number; longitude: number; radiusM: number }) => circleRing([st.longitude, st.latitude], st.radiusM);
    (m.getSource("sel-stops") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { color: "#0e7c66" }, geometry: { type: "Polygon", coordinates: [ring(s.pickup)] } },
        { type: "Feature", properties: { color: "#d81e2c" }, geometry: { type: "Polygon", coordinates: [ring(s.delivery)] } }
      ]
    });
    stopMarkers.current = [
      new maplibregl.Marker({ element: pin("P", "#0e7c66"), anchor: "bottom" }).setLngLat([s.pickup.longitude, s.pickup.latitude]).addTo(m),
      new maplibregl.Marker({ element: pin("D", "#d81e2c"), anchor: "bottom" }).setLngLat([s.delivery.longitude, s.delivery.latitude]).addTo(m)
    ];
    const trail = detail?.id === s.id ? detail.trail.map(([lon, lat]) => [lon, lat]) : [];
    (m.getSource("sel-trail") as GeoJSONSource).setData(trail.length >= 2 ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: trail } }] } : empty);
    const next = s.status === "invited" || s.status === "tracking" ? s.pickup : s.delivery;
    (m.getSource("sel-next") as GeoJSONSource).setData(
      s.lastPosition && s.status !== "at_delivery"
        ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[s.lastPosition.longitude, s.lastPosition.latitude], [next.longitude, next.latitude]] } }] }
        : empty
    );
  }, [sel, detail, loaded]);

  function select(id: string, fly = true) {
    setSelected(id);
    setSheetOpen(false);
    const r = rows.find((x) => x.load.id === id);
    const m = map.current;
    if (!fly || !m || !r) return;
    const b = new maplibregl.LngLatBounds();
    if (r.load.lastPosition) b.extend([r.load.lastPosition.longitude, r.load.lastPosition.latitude]);
    b.extend([r.load.pickup.longitude, r.load.pickup.latitude]).extend([r.load.delivery.longitude, r.load.delivery.latitude]);
    m.fitBounds(b, { padding: 80, maxZoom: 12, duration: 600 });
  }

  // ---- panel ----
  const motionText = (r: Row) => (r.motion === "moving" && r.load.lastPosition ? u.fmtSpeed(r.load.lastPosition.speedKph) : MOTION_META[r.motion].label);

  const card = sel && (
    <section aria-label={`Load ${sel.load.reference}`} className="grid gap-3 border-b border-border bg-primary-soft/40 px-4 py-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-base font-semibold">Load {sel.load.reference}</p>
          <p className="m-0 truncate text-sm text-muted-foreground">{lane(sel.load)}</p>
        </div>
        <button type="button" aria-label="Close load details" onClick={() => setSelected(null)} className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge tone={LOAD_STATUS_META[sel.load.status].tone} label={LOAD_STATUS_META[sel.load.status].label} />
        <span className="inline-flex items-center gap-1.5 rounded-full bg-background px-2 py-0.5 text-xs font-medium">
          <span aria-hidden="true" className="size-2 rounded-full" style={{ background: MOTION_META[sel.motion].color }} />
          {motionText(sel)}
        </span>
        {sel.load.eta?.late && <StatusBadge tone="danger" label="Late" />}
      </div>
      <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">ETA {sel.load.eta ? `to ${sel.load.eta.target}` : ""}</dt>
          <dd className={cn("m-0 font-medium tabular-nums", sel.load.eta?.late && "text-danger")}>{sel.load.eta ? t.dateTime(sel.load.eta.at) : "—"}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Remaining</dt>
          <dd className="m-0 font-medium">{sel.load.eta ? fmtDistanceM(sel.load.eta.distanceM, u.system === "imperial") : "—"}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Last location</dt>
          <dd className="m-0 font-medium">{sel.load.lastPosition ? ago(sel.load.lastPosition.at, now) : "None yet"}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{sel.load.vehicle ? "Vehicle" : "Driver"}</dt>
          <dd className="m-0 truncate font-medium">{sel.load.vehicle?.name ?? sel.load.driverName ?? sel.load.driverPhone ?? "—"}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link href={`/loads/${sel.load.id}`}>
            <ExternalLink /> Open load
          </Link>
        </Button>
        {sel.load.driverPhone && (
          <Button asChild size="sm" variant="secondary">
            <a href={`tel:${sel.load.driverPhone}`}>
              <Phone /> Call driver
            </a>
          </Button>
        )}
      </div>
    </section>
  );

  const panel = (
    <>
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h1 className="m-0 text-base font-semibold">Loads map</h1>
          <span className="text-sm text-muted-foreground">{counts.all} active</span>
          <div className="ml-auto flex gap-1">
            <Button asChild size="sm" variant="ghost" title="List view">
              <Link href="/loads">
                <List /> <span className="sr-only">List view</span>
              </Link>
            </Button>
            {canWrite && (
              <Button asChild size="sm" variant="secondary">
                <Link href="/loads/new">
                  <PackagePlus /> New
                </Link>
              </Button>
            )}
          </div>
        </div>
        <div role="radiogroup" aria-label="Show" className="mt-2 flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium",
                filter === f.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-muted"
              )}
            >
              {f.value === "attention" && <AlertTriangle className={cn("size-3", filter !== f.value && "text-danger")} aria-hidden="true" />}
              {f.value !== "all" && f.value !== "attention" && <span aria-hidden="true" className="size-2 rounded-full" style={{ background: MOTION_META[f.value].color }} />}
              {f.label}
              <span className={cn("tabular-nums", filter === f.value ? "text-primary-foreground/80" : "text-muted-foreground")}>{counts[f.value]}</span>
            </button>
          ))}
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Load #, driver, truck, city…"
          aria-label="Search loads"
          className="mt-2 box-border block h-8 w-full rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:border-ring"
        />
      </div>
      {card}
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No active loads"
            description="Loads appear here when a driver starts sharing or a tracker is assigned."
            action={
              canWrite ? (
                <Button asChild size="sm">
                  <Link href="/loads/new">New load</Link>
                </Button>
              ) : undefined
            }
          />
        ) : shown.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No loads match this filter.</p>
        ) : (
          <ul className="m-0 list-none p-0" aria-label="Loads">
            {shown.map((r) => {
              const l = r.load;
              const active = l.id === selected;
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => select(l.id)}
                    aria-pressed={active}
                    className={cn("flex w-full cursor-pointer flex-col gap-0.5 border-0 border-b border-border/70 bg-transparent px-4 py-2.5 text-left hover:bg-muted", active && "bg-primary-soft hover:bg-primary-soft")}
                  >
                    <span className="flex items-center gap-2 text-sm">
                      <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-full", r.attention && "ring-2 ring-danger ring-offset-1")} style={{ background: MOTION_META[r.motion].color }} />
                      <span className="font-semibold">{l.reference}</span>
                      {l.vehicle && <Truck className="size-3.5 text-muted-foreground" aria-label="Tracked by vehicle" />}
                      <span className={cn("ml-auto shrink-0 text-xs tabular-nums", r.motion === "moving" ? "font-medium text-success" : "text-muted-foreground")}>{motionText(r)}</span>
                    </span>
                    <span className="flex items-center gap-1 truncate pl-[18px] text-xs text-muted-foreground">
                      {shortPlace(l.pickup.name, l.pickup.address)} <ArrowRight className="size-3 shrink-0" aria-label="to" /> {shortPlace(l.delivery.name, l.delivery.address)}
                    </span>
                    <span className="flex items-center gap-2 pl-[18px] text-xs">
                      <span className="text-muted-foreground">{LOAD_STATUS_META[l.status].label}</span>
                      {l.eta && (
                        <span className={cn("ml-auto shrink-0 tabular-nums", l.eta.late ? "font-medium text-danger" : "text-muted-foreground")}>
                          {l.eta.late ? "Late · " : "ETA "}
                          {t.time(l.eta.at)}
                        </span>
                      )}
                      {!l.eta && l.lastPosition && <span className="ml-auto shrink-0 text-muted-foreground">{ago(l.lastPosition.at, now)}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );

  return (
    <div className="absolute inset-0 flex">
      <div className="relative order-2 min-w-0 flex-1">
        <div className="absolute inset-0">
          <div ref={mapDiv} className="h-full w-full" />
        </div>
        <div className="absolute left-3 top-3 z-[1] flex flex-wrap gap-2 pr-14">
          <Button size="sm" variant="secondary" className="hidden md:inline-flex" aria-expanded={panelOpen} aria-label={panelOpen ? "Hide load list" : "Show load list"} title={panelOpen ? "Hide load list" : "Show load list"} onClick={() => setPanelOpen((v) => !v)}>
            {panelOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => fitAll(true)} disabled={!rows.some((r) => r.load.lastPosition)}>
            <Maximize2 /> Fit all
          </Button>
        </div>
        {/* Legend */}
        <div className="pointer-events-none absolute bottom-8 left-3 z-[1] hidden rounded-lg border border-border bg-background/95 px-3 py-2 text-xs shadow-card md:block">
          <ul className="m-0 grid list-none gap-1 p-0">
            {(["moving", "stopped", "paused", "no_signal"] as const).map((k) => (
              <li key={k} className="flex items-center gap-2">
                <span aria-hidden="true" className="size-2.5 rounded-full border-2 border-white shadow-sm" style={{ background: MOTION_META[k].color }} />
                {MOTION_META[k].label}
              </li>
            ))}
            <li className="flex items-center gap-2">
              <span aria-hidden="true" className="size-2.5 rounded-full border-2 border-danger bg-danger-soft" />
              Needs attention
            </li>
          </ul>
        </div>
        {refreshError && (
          <div className="absolute inset-x-3 top-14 z-[1] md:right-14">
            <Alert tone="warning">Couldn&apos;t refresh. Showing the last known positions; retrying.</Alert>
          </div>
        )}
      </div>

      {/* Side panel from md up, bottom sheet on phones. */}
      <aside
        aria-label="Loads"
        className={cn(
          "absolute inset-x-0 bottom-0 z-[2] flex flex-col rounded-t-xl border-t border-border bg-background shadow-pop transition-[height] duration-200",
          sheetOpen ? "h-[70%]" : sel ? "h-[330px]" : "h-[148px]",
          "md:static md:order-1 md:h-auto md:w-[360px] md:shrink-0 md:rounded-none md:border-r md:border-t-0 md:shadow-none md:transition-none",
          !panelOpen && "md:hidden"
        )}
      >
        <button type="button" className="flex shrink-0 cursor-pointer items-center justify-center gap-1 border-0 bg-transparent py-1.5 text-xs text-muted-foreground md:hidden" aria-expanded={sheetOpen} onClick={() => setSheetOpen((v) => !v)}>
          <ChevronUp className={cn("size-4 transition-transform", sheetOpen && "rotate-180")} aria-hidden="true" />
          {sheetOpen ? "Hide load list" : "Show load list"}
        </button>
        <div className="flex min-h-0 flex-1 flex-col">{panel}</div>
      </aside>
    </div>
  );
}
