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

export const STATE_COLORS: Record<MapState, string> = { moving: "#15803d", idle: "#b45309", offline: "#6b7280" };

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
  private handlers: Array<() => void> = [];

  constructor(
    private map: MlMap,
    private opts: { onSelect: (id: string) => void; onHover?: (id: string | null, lngLat?: [number, number]) => void }
  ) {}

  /** Call after the style has loaded. Safe to call again after a style change. */
  install() {
    const m = this.map;
    for (const s of ["moving", "idle", "offline"] as MapState[]) {
      const id = `veh-${s}`;
      if (!m.hasImage(id)) {
        const { img, ratio } = arrowIcon(STATE_COLORS[s], s !== "offline");
        m.addImage(id, img, { pixelRatio: ratio });
      }
    }
    // promoteId lets live updates send only the vehicles that changed (updateData diff).
    if (!m.getSource(SRC)) m.addSource(SRC, { type: "geojson", data: this.collection(), promoteId: "id" });
    this.structural = true;
    if (!m.getLayer("fleet-halo")) {
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
        layout: {
          "icon-image": ["concat", "veh-", ["get", "state"]],
          "icon-rotate": ["get", "heading"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "symbol-sort-key": ["match", ["get", "state"], "moving", 3, "idle", 2, 1]
        }
      });
      // Names need glyphs; the production style has them, a bare style may not.
      if (m.getStyle().glyphs) {
        m.addLayer({
          id: "fleet-labels",
          type: "symbol",
          source: SRC,
          minzoom: 10,
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
    this.applyFilter();
    this.applySelection();
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
    this.applyFilter();
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

  private applyFilter() {
    if (!this.ready || !this.map.getLayer("fleet-icons")) return;
    const parts: unknown[] = [];
    if (this.filterStates) parts.push(["in", ["get", "state"], ["literal", this.filterStates]]);
    if (this.filterIds) parts.push(["in", ["get", "id"], ["literal", [...this.filterIds]]]);
    const f = (parts.length ? ["all", ...parts] : null) as Parameters<MlMap["setFilter"]>[1];
    this.map.setFilter("fleet-icons", f);
    if (this.map.getLayer("fleet-labels")) this.map.setFilter("fleet-labels", f);
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
    const src = this.map.getSource(SRC) as GeoJSONSource | undefined;
    if (src) {
      if (this.structural) src.setData(this.collection());
      else if (this.changed.size) {
        src.updateData({
          update: [...this.changed].flatMap((id) => {
            const p = this.points.get(id);
            if (!p) return [];
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
    for (const p of this.points.values()) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: this.display.get(p.id) ?? p.lngLat },
        properties: { id: p.id, name: p.name, state: p.state, heading: p.heading ?? 0 }
      });
    }
    return { type: "FeatureCollection", features };
  }
}
