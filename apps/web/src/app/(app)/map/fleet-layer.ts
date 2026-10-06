/**
 * Imperative MapLibre layer for the fleet: one GeoJSON source, a few layers,
 * no per-vehicle DOM. Updates are coalesced into one setData per animation
 * frame, and moves are interpolated on screen only (the data is untouched).
 */
import type { GeoJSONSource, Map as MlMap, MapLayerMouseEvent } from "maplibre-gl";
import { bearing, lerpLngLat, shouldAnimate, type MapState } from "./fleet-model";

export interface FleetPoint {
  id: string;
  name: string;
  state: MapState;
  lngLat: [number, number];
  heading: number | null;
}

const SRC = "fleet";
const ANIM_MS = 900;
/** Beyond this many simultaneous moves, skip animation (teleport) to keep frames cheap. */
const MAX_ANIMATING = 400;
const MIN_FRAME_MS = 33; // ~30 fps is plenty for smooth marker glides

export const STATE_COLORS: Record<MapState, string> = { moving: "#15803d", idle: "#b45309", stopped: "#c42b2b", offline: "#6b7280" };
/** Below this zoom nearby vehicles merge into one counted bubble, so a large fleet stays readable. */
const CLUSTER_MAX_ZOOM = 8;
const NOT_CLUSTER = ["!", ["has", "point_count"]];

interface Anim {
  from: [number, number];
  to: [number, number];
  start: number;
}

/** Circle with a white direction arrow, drawn once per state at device pixel ratio. */
function arrowIcon(color: string, withArrow: boolean) {
  const ratio = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
  const size = Math.round(28 * ratio);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const r = size / 2;
  g.beginPath();
  g.arc(r, r, r - 2 * ratio, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.lineWidth = 2 * ratio;
  g.strokeStyle = "#ffffff";
  g.stroke();
  g.fillStyle = "#ffffff";
  if (withArrow) {
    g.beginPath();
    g.moveTo(r, r - 8 * ratio);
    g.lineTo(r + 6 * ratio, r + 7 * ratio);
    g.lineTo(r, r + 3.5 * ratio);
    g.lineTo(r - 6 * ratio, r + 7 * ratio);
    g.closePath();
    g.fill();
  } else {
    g.beginPath();
    g.arc(r, r, 3.5 * ratio, 0, Math.PI * 2);
    g.fill();
  }
  return { img: g.getImageData(0, 0, size, size), ratio };
}

export class FleetLayer {
  private points = new Map<string, FleetPoint>();
  private display = new Map<string, [number, number]>();
  private anims = new Map<string, Anim>();
  private raf = 0;
  private lastFrame = 0;
  private dirty = false;
  /** Full rebuild needed (snapshot, add/remove); otherwise only `changed` ids are sent. */
  private structural = true;
  private changed = new Set<string>();
  private reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  private ready = false;
  private selected: string | null = null;
  private filterStates: MapState[] | null = null;
  private filterIds: Set<string> | null = null;
  /** Ids currently in the map source (filters are applied to the data, so cluster counts match the list). */
  private inSource = new Set<string>();
  private labels = true;
  private handlers: Array<() => void> = [];

  constructor(
    private map: MlMap,
    private opts: { onSelect: (id: string) => void; onHover?: (id: string | null, lngLat?: [number, number]) => void }
  ) {}

  /** Call after the style has loaded. Safe to call again after a style change. */
  install() {
    const m = this.map;
    for (const s of ["moving", "idle", "stopped", "offline"] as MapState[]) {
      const id = `veh-${s}`;
      if (!m.hasImage(id)) {
        const { img, ratio } = arrowIcon(STATE_COLORS[s], s === "moving" || s === "idle");
        m.addImage(id, img, { pixelRatio: ratio });
      }
    }
    // promoteId lets live updates send only the vehicles that changed (updateData diff).
    if (!m.getSource(SRC)) m.addSource(SRC, { type: "geojson", data: this.collection(), promoteId: "id", cluster: true, clusterMaxZoom: CLUSTER_MAX_ZOOM, clusterRadius: 48 });
    this.structural = true;
    if (!m.getLayer("fleet-halo")) {
      m.addLayer({
        id: "fleet-clusters",
        type: "circle",
        source: SRC,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#1f2937",
          "circle-opacity": 0.92,
          "circle-radius": ["step", ["get", "point_count"], 16, 10, 20, 50, 25, 200, 30],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2
        }
      });
      if (m.getStyle().glyphs) {
        m.addLayer({
          id: "fleet-cluster-count",
          type: "symbol",
          source: SRC,
          filter: ["has", "point_count"],
          layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Regular"], "text-size": 13, "text-allow-overlap": true },
          paint: { "text-color": "#ffffff" }
        });
      }
      m.addLayer({
        id: "fleet-halo",
        type: "circle",
        source: SRC,
        filter: ["==", ["get", "id"], ""],
        paint: { "circle-radius": 21, "circle-color": "#2f5bea", "circle-opacity": 0.18, "circle-stroke-color": "#2f5bea", "circle-stroke-width": 2 }
      });
      m.addLayer({
        id: "fleet-icons",
        type: "symbol",
        source: SRC,
        filter: NOT_CLUSTER as never,
        layout: {
          "icon-image": ["concat", "veh-", ["get", "state"]],
          "icon-rotate": ["to-number", ["coalesce", ["get", "heading"], 0]],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "symbol-sort-key": ["match", ["get", "state"], "moving", 4, "idle", 3, "stopped", 2, 1]
        }
      });
      // Names need glyphs; the production style has them, a bare style may not.
      if (m.getStyle().glyphs) {
        m.addLayer({
          id: "fleet-labels",
          type: "symbol",
          source: SRC,
          minzoom: 10,
          filter: NOT_CLUSTER as never,
          layout: {
            "text-field": ["get", "name"],
            "text-font": ["Noto Sans Regular"],
            "text-size": 12,
            "text-offset": [0, 1.5],
            "text-anchor": "top",
            "text-optional": true
          },
          paint: { "text-color": "#111827", "text-halo-color": "#ffffff", "text-halo-width": 1.5 }
        });
      }
      const click = (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) this.opts.onSelect(id);
      };
      const enter = (e: MapLayerMouseEvent) => {
        m.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        const id = f?.properties?.id as string | undefined;
        if (id && f?.geometry.type === "Point") this.opts.onHover?.(id, f.geometry.coordinates as [number, number]);
      };
      const leave = () => {
        m.getCanvas().style.cursor = "";
        this.opts.onHover?.(null);
      };
      // A bubble zooms in just far enough to split apart.
      const clusterClick = (e: MapLayerMouseEvent) => {
        const f = e.features?.[0];
        const cid = f?.properties?.cluster_id as number | undefined;
        if (cid === undefined || f?.geometry.type !== "Point") return;
        const center = f.geometry.coordinates as [number, number];
        (m.getSource(SRC) as GeoJSONSource)
          .getClusterExpansionZoom(cid)
          .then((zoom) => m.easeTo({ center, zoom: Math.min(zoom + 0.5, 16), duration: 500 }))
          .catch((err) => console.error("cluster zoom failed", err));
      };
      const clusterEnter = () => {
        m.getCanvas().style.cursor = "pointer";
      };
      const clusterLeave = () => {
        m.getCanvas().style.cursor = "";
      };
      m.on("click", "fleet-clusters", clusterClick);
      m.on("mouseenter", "fleet-clusters", clusterEnter);
      m.on("mouseleave", "fleet-clusters", clusterLeave);
      this.handlers.push(() => {
        m.off("click", "fleet-clusters", clusterClick);
        m.off("mouseenter", "fleet-clusters", clusterEnter);
        m.off("mouseleave", "fleet-clusters", clusterLeave);
      });
      m.on("click", "fleet-icons", click);
      m.on("mousemove", "fleet-icons", enter);
      m.on("mouseleave", "fleet-icons", leave);
      this.handlers.push(() => {
        m.off("click", "fleet-icons", click);
        m.off("mousemove", "fleet-icons", enter);
        m.off("mouseleave", "fleet-icons", leave);
      });
    }
    this.ready = true;
    this.applySelection();
    this.applyLabels();
    this.schedule();
  }

  /** Replace everything (snapshot). No animation. */
  reset(points: FleetPoint[]) {
    this.points.clear();
    this.display.clear();
    this.anims.clear();
    for (const p of points) {
      this.points.set(p.id, p);
      this.display.set(p.id, p.lngLat);
    }
    this.structural = true;
    this.schedule();
  }

  /** Apply changed points (live updates, state changes). Moves glide from the displayed position. */
  upsert(points: FleetPoint[]) {
    const now = performance.now();
    const animate = !this.reduceMotion && this.map.getZoom() >= 9;
    for (const p of points) {
      const shown = this.display.get(p.id);
      if (!this.points.has(p.id)) this.structural = true;
      this.changed.add(p.id);
      const heading = p.heading ?? (shown ? bearing(shown, p.lngLat) : null);
      this.points.set(p.id, { ...p, heading });
      if (shown && animate && this.anims.size < MAX_ANIMATING && shouldAnimate(shown, p.lngLat)) {
        this.anims.set(p.id, { from: shown, to: p.lngLat, start: now });
      } else {
        this.anims.delete(p.id);
        this.display.set(p.id, p.lngLat);
      }
    }
    this.schedule();
  }

  remove(ids: string[]) {
    for (const id of ids) {
      this.points.delete(id);
      this.display.delete(id);
      this.anims.delete(id);
    }
    this.structural = true;
    this.schedule();
  }

  select(id: string | null) {
    this.selected = id;
    this.applySelection();
  }

  /** null = no filter. */
  filter(states: MapState[] | null, ids: Set<string> | null) {
    this.filterStates = states;
    this.filterIds = ids;
    this.structural = true;
    this.schedule();
  }

  /** Show or hide vehicle names next to the markers. */
  setLabels(visible: boolean) {
    this.labels = visible;
    this.applyLabels();
  }

  displayed(id: string): [number, number] | undefined {
    return this.display.get(id);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.handlers.forEach((h) => h());
    this.handlers = [];
    this.ready = false;
  }

  private applySelection() {
    if (!this.ready || !this.map.getLayer("fleet-halo")) return;
    this.map.setFilter("fleet-halo", ["==", ["get", "id"], this.selected ?? ""]);
  }

  private applyLabels() {
    if (!this.ready || !this.map.getLayer("fleet-labels")) return;
    this.map.setLayoutProperty("fleet-labels", "visibility", this.labels ? "visible" : "none");
  }

  private passes(p: FleetPoint) {
    return (!this.filterStates || this.filterStates.includes(p.state)) && (!this.filterIds || this.filterIds.has(p.id));
  }

  private schedule() {
    this.dirty = true;
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (t: number) => {
    this.raf = 0;
    if (!this.ready) return;
    const animating = this.anims.size > 0;
    if (animating && !this.dirty && t - this.lastFrame < MIN_FRAME_MS) {
      this.raf = requestAnimationFrame(this.frame);
      return;
    }
    for (const [id, a] of this.anims) {
      const k = (t - a.start) / ANIM_MS;
      if (k >= 1) {
        this.display.set(id, a.to);
        this.anims.delete(id);
      } else this.display.set(id, lerpLngLat(a.from, a.to, k));
      this.changed.add(id);
    }
    // A vehicle entering or leaving the active filter changes what is on the map: rebuild.
    if (!this.structural) {
      for (const id of this.changed) {
        const p = this.points.get(id);
        if (p && this.passes(p) !== this.inSource.has(id)) {
          this.structural = true;
          break;
        }
      }
    }
    const src = this.map.getSource(SRC) as GeoJSONSource | undefined;
    if (src) {
      if (this.structural) src.setData(this.collection());
      else if (this.changed.size) {
        src.updateData({
          update: [...this.changed].flatMap((id) => {
            const p = this.points.get(id);
            if (!p || !this.inSource.has(id)) return [];
            return [
              {
                id,
                newGeometry: { type: "Point", coordinates: this.display.get(id) ?? p.lngLat },
                addOrUpdateProperties: [
                  { key: "state", value: p.state },
                  { key: "heading", value: p.heading ?? 0 },
                  { key: "name", value: p.name }
                ]
              }
            ];
          })
        });
      }
    }
    this.structural = false;
    this.changed.clear();
    this.lastFrame = t;
    this.dirty = false;
    if (this.anims.size > 0) this.raf = requestAnimationFrame(this.frame);
  };

  private collection(): GeoJSON.FeatureCollection<GeoJSON.Point> {
    const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
    this.inSource.clear();
    for (const p of this.points.values()) {
      if (!this.passes(p)) continue;
      this.inSource.add(p.id);
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: this.display.get(p.id) ?? p.lngLat },
        properties: { id: p.id, name: p.name, state: p.state, heading: p.heading ?? 0 }
      });
    }
    return { type: "FeatureCollection", features };
  }
}
