/**
 * Imperative MapLibre layer for the fleet: one GeoJSON source, a few layers,
 * no per-vehicle DOM. Updates are coalesced into one setData per animation
 * frame, and moves are interpolated on screen only (the data is untouched).
 */
import type { GeoJSONSource, Map as MlMap, MapLayerMouseEvent } from "maplibre-gl";
import { VEHICLE_TYPES, type VehicleType } from "@/lib/schemas/vehicle";
import { VEHICLE_GLYPHS, WHEEL_Y } from "@/lib/vehicle-glyphs";
import { bearing, lerpLngLat, shouldAnimate, type MapState } from "./fleet-model";

export interface FleetPoint {
  id: string;
  name: string;
  state: MapState;
  /** Kind of vehicle: picks the pictogram inside the marker. */
  type: VehicleType;
  lngLat: [number, number];
  heading: number | null;
  /** Second line of the name chip, e.g. "62 mph" or "Parked". */
  sub?: string;
}

const SRC = "fleet";
const TRAILS = "fleet-trails";
/** Recent real positions kept per moving vehicle for its trail. */
const TRAIL_POINTS = 8;
const ANIM_MS = 900;
/** Beyond this many simultaneous moves, skip animation (teleport) to keep frames cheap. */
const MAX_ANIMATING = 400;
const MIN_FRAME_MS = 33; // ~30 fps is plenty for smooth marker glides

export const STATE_COLORS: Record<MapState, string> = { moving: "#15803d", idle: "#b45309", stopped: "#0369a1", parked: "#0369a1", offline: "#6b7280" };
/** Below this zoom nearby vehicles merge into one counted bubble, so a large fleet stays readable. */
const CLUSTER_MAX_ZOOM = 8;
const NOT_CLUSTER = ["!", ["has", "point_count"]];
const HALO_R = 23;
/** Below this zoom every vehicle is a small status dot: with 50+ vehicles, detailed icons would pile up. */
const DETAIL_ZOOM = 11;

interface Anim {
  from: [number, number];
  to: [number, number];
  start: number;
}

const pixelRatio = () => Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);

/** Top-down silhouettes, drawn on a 24 x 48 grid pointing up (north). */
type Shape = "car" | "van" | "truck" | "trailer";
export const SHAPE_OF: Record<VehicleType, Shape> = { car: "car", pickup: "car", other: "car", van: "van", bus: "truck", truck: "truck", semi: "truck", equipment: "truck", trailer: "trailer" };
const SPRITE_W = 26;
const SPRITE_H = 52;

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/**
 * A moving vehicle seen from above, like the cars in ride-hailing apps: body in the status
 * colour, dark glass, white outline and a soft shadow. Rotated to the heading on the map.
 */
function spriteIcon(shape: Shape, color: string) {
  const ratio = pixelRatio();
  const pad = 6;
  const c = document.createElement("canvas");
  c.width = Math.round((SPRITE_W + pad * 2) * ratio);
  c.height = Math.round((SPRITE_H + pad * 2) * ratio);
  const g = c.getContext("2d")!;
  g.scale(ratio, ratio);
  g.translate(pad, pad);
  const glass = "#0b1b3f";
  const body = (x: number, y: number, w: number, h: number, r: number) => {
    g.save();
    g.shadowColor = "rgba(10, 20, 45, 0.35)";
    g.shadowBlur = 5;
    g.shadowOffsetY = 2;
    roundRect(g, x, y, w, h, r);
    g.fillStyle = color;
    g.fill();
    g.restore();
    roundRect(g, x, y, w, h, r);
    g.lineWidth = 1.6;
    g.strokeStyle = "#ffffff";
    g.stroke();
  };
  const pane = (x: number, y: number, w: number, h: number, r: number) => {
    roundRect(g, x, y, w, h, r);
    g.fillStyle = glass;
    g.fill();
  };
  if (shape === "car") {
    body(4, 8, 18, 36, 7);
    pane(6.5, 15, 13, 7, 2.5); // windscreen
    roundRect(g, 7, 23, 12, 10, 2);
    g.fillStyle = "rgba(255,255,255,0.22)"; // roof
    g.fill();
    pane(7, 34, 12, 5, 2); // rear window
    g.fillStyle = "#fde68a";
    g.fillRect(6.5, 8.6, 3, 1.6); // headlights
    g.fillRect(16.5, 8.6, 3, 1.6);
  } else if (shape === "van") {
    body(4, 5, 18, 42, 5);
    pane(6, 10, 14, 7, 2);
    roundRect(g, 6.5, 19, 13, 25, 1.5);
    g.fillStyle = "rgba(255,255,255,0.2)";
    g.fill();
  } else if (shape === "truck") {
    // Cab in front, long box behind with a small gap, so it reads as a truck at a glance.
    body(5, 2, 16, 12, 4);
    pane(7, 4.5, 12, 4.5, 1.5);
    body(3.5, 16, 19, 34, 2.5);
    g.strokeStyle = "rgba(255,255,255,0.35)";
    g.lineWidth = 1;
    for (const y of [24, 32, 40]) {
      g.beginPath();
      g.moveTo(6, y);
      g.lineTo(20, y);
      g.stroke();
    }
  } else {
    // Trailer: box with a short tow bar at the front.
    g.fillStyle = color;
    g.fillRect(12, 2, 2, 8);
    body(3.5, 9, 19, 41, 2.5);
    g.strokeStyle = "rgba(255,255,255,0.35)";
    g.lineWidth = 1;
    for (const y of [19, 29, 39]) {
      g.beginPath();
      g.moveTo(6, y);
      g.lineTo(20, y);
      g.stroke();
    }
  }
  return { img: g.getImageData(0, 0, c.width, c.height), ratio };
}

const PIN_W = 34;
const PIN_H = 44;

/** A parked, idling or offline vehicle: a map pin in the status colour with the vehicle pictogram inside. */
function pinIcon(type: VehicleType, color: string) {
  const ratio = pixelRatio();
  const c = document.createElement("canvas");
  c.width = Math.round(PIN_W * ratio);
  c.height = Math.round(PIN_H * ratio);
  const g = c.getContext("2d")!;
  g.scale(ratio, ratio);
  const cx = PIN_W / 2;
  const cy = 16;
  const r = 13.5;
  g.save();
  g.shadowColor = "rgba(10, 20, 45, 0.35)";
  g.shadowBlur = 4;
  g.shadowOffsetY = 2;
  g.beginPath();
  g.moveTo(cx, PIN_H - 3);
  g.bezierCurveTo(cx - 4, cy + r + 2, cx - r, cy + 8, cx - r, cy);
  g.arc(cx, cy, r, Math.PI, 0);
  g.bezierCurveTo(cx + r, cy + 8, cx + 4, cy + r + 2, cx, PIN_H - 3);
  g.closePath();
  g.fillStyle = color;
  g.fill();
  g.restore();
  g.lineWidth = 2;
  g.strokeStyle = "#ffffff";
  g.stroke();
  // White disc with the pictogram in the status colour.
  g.beginPath();
  g.arc(cx, cy, 10.5, 0, Math.PI * 2);
  g.fillStyle = "#ffffff";
  g.fill();
  const k = 15 / 24;
  g.save();
  g.translate(cx - 12 * k, cy - 11.6 * k);
  g.scale(k, k);
  const glyph = VEHICLE_GLYPHS[type];
  g.fillStyle = color;
  g.fill(new Path2D(glyph.body));
  for (const [x, wr] of glyph.wheels) {
    g.beginPath();
    g.arc(x, WHEEL_Y, wr + 0.9, 0, Math.PI * 2);
    g.fillStyle = "#ffffff";
    g.fill();
    g.beginPath();
    g.arc(x, WHEEL_Y, wr, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
  }
  g.restore();
  return { img: g.getImageData(0, 0, c.width, c.height), ratio };
}

/** White rounded card behind vehicle names; stretches to fit the text (icon-text-fit). */
function chipIcon() {
  const ratio = pixelRatio();
  const w = 24;
  const h = 24;
  const c = document.createElement("canvas");
  c.width = w * ratio;
  c.height = h * ratio;
  const g = c.getContext("2d")!;
  g.scale(ratio, ratio);
  g.save();
  g.shadowColor = "rgba(10, 20, 45, 0.22)";
  g.shadowBlur = 4;
  g.shadowOffsetY = 1;
  roundRect(g, 3, 3, w - 6, h - 6, 6);
  g.fillStyle = "#ffffff";
  g.fill();
  g.restore();
  return { img: g.getImageData(0, 0, c.width, c.height), ratio, w, h };
}

/** Circle with a white direction arrow (used for the history playback marker). */
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
  private trails = new Map<string, [number, number][]>();
  private trailsDirty = false;
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
  private clustering = true;
  private handlers: Array<() => void> = [];

  constructor(
    private map: MlMap,
    private opts: { onSelect: (id: string) => void; onHover?: (id: string | null, lngLat?: [number, number]) => void }
  ) {}

  /** Call after the style has loaded. Safe to call again after a style change. */
  install() {
    const m = this.map;
    for (const s of ["moving", "idle", "stopped", "parked", "offline"] as MapState[]) {
      for (const t of VEHICLE_TYPES) {
        const id = `pin-${t}-${s}`;
        if (!m.hasImage(id)) {
          const { img, ratio } = pinIcon(t, STATE_COLORS[s]);
          m.addImage(id, img, { pixelRatio: ratio });
        }
      }
    }
    for (const shape of ["car", "van", "truck", "trailer"] as Shape[]) {
      const id = `spr-${shape}`;
      if (!m.hasImage(id)) {
        const { img, ratio } = spriteIcon(shape, STATE_COLORS.moving);
        m.addImage(id, img, { pixelRatio: ratio });
      }
    }
    if (!m.hasImage("veh-chip")) {
      const { img, ratio, w, h } = chipIcon();
      // Stretch only the flat middle so the rounded corners keep their shape.
      m.addImage("veh-chip", img, { pixelRatio: ratio, stretchX: [[9 * ratio, (w - 9) * ratio]], stretchY: [[9 * ratio, (h - 9) * ratio]], content: [7 * ratio, 6 * ratio, (w - 7) * ratio, (h - 6) * ratio] });
    }
    // History playback marker.
    if (!m.hasImage("veh-moving")) {
      const { img, ratio } = arrowIcon(STATE_COLORS.moving, true);
      m.addImage("veh-moving", img, { pixelRatio: ratio });
    }
    // promoteId lets live updates send only the vehicles that changed (updateData diff).
    if (!m.getSource(TRAILS)) m.addSource(TRAILS, { type: "geojson", data: { type: "FeatureCollection", features: [] }, lineMetrics: true });
    if (!m.getSource(SRC)) m.addSource(SRC, { type: "geojson", data: this.collection(), promoteId: "id", cluster: this.clustering, clusterMaxZoom: CLUSTER_MAX_ZOOM, clusterRadius: 48 });
    this.structural = true;
    if (!m.getLayer("fleet-halo")) {
      // Fading tail behind moving vehicles: where they have just been, brightest at the vehicle.
      m.addLayer({
        id: "fleet-trails",
        type: "line",
        source: TRAILS,
        minzoom: DETAIL_ZOOM,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-width": ["interpolate", ["linear"], ["zoom"], 9, 3, 15, 6],
          "line-gradient": ["interpolate", ["linear"], ["line-progress"], 0, "rgba(21, 128, 61, 0)", 1, "rgba(21, 128, 61, 0.75)"]
        }
      });
      // Groups of vehicles: a navy bubble in the brand colour with a soft ring, larger for bigger groups.
      m.addLayer({
        id: "fleet-clusters-ring",
        type: "circle",
        source: SRC,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#1d4fb8",
          "circle-opacity": 0.18,
          "circle-radius": ["step", ["get", "point_count"], 24, 10, 28, 50, 34, 200, 40]
        }
      });
      m.addLayer({
        id: "fleet-clusters",
        type: "circle",
        source: SRC,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": ["step", ["get", "point_count"], "#1d4fb8", 10, "#12357f", 50, "#0a2463"],
          "circle-radius": ["step", ["get", "point_count"], 16, 10, 20, 50, 25, 200, 30],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2.5
        }
      });
      if (m.getStyle().glyphs) {
        m.addLayer({
          id: "fleet-cluster-count",
          type: "symbol",
          source: SRC,
          filter: ["has", "point_count"],
          layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Regular"], "text-size": 13, "text-allow-overlap": true },
          // Bold count, readable on the navy bubble.
          paint: { "text-color": "#ffffff" }
        });
      }
      m.addLayer({
        id: "fleet-halo",
        type: "circle",
        source: SRC,
        filter: ["==", ["get", "id"], ""],
        paint: { "circle-radius": HALO_R, "circle-radius-transition": { duration: 320, delay: 0 }, "circle-color": "#2f5bea", "circle-opacity": 0.18, "circle-stroke-color": "#2f5bea", "circle-stroke-width": 2 }
      });
      // Zoomed out: a dot per vehicle in its status colour, moving ones on top.
      m.addLayer({
        id: "fleet-dots",
        type: "circle",
        source: SRC,
        maxzoom: DETAIL_ZOOM,
        filter: NOT_CLUSTER as never,
        layout: { "circle-sort-key": ["match", ["get", "state"], "moving", 4, "idle", 3, "stopped", 2, 1] },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 4, 10, 7],
          "circle-color": ["match", ["get", "state"], "moving", STATE_COLORS.moving, "idle", STATE_COLORS.idle, "stopped", STATE_COLORS.stopped, "parked", STATE_COLORS.parked, STATE_COLORS.offline],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2
        }
      });
      // Moving: a top-down vehicle that turns with the road.
      m.addLayer({
        id: "fleet-moving",
        type: "symbol",
        source: SRC,
        minzoom: DETAIL_ZOOM,
        filter: ["all", NOT_CLUSTER, ["==", ["get", "state"], "moving"]] as never,
        layout: {
          "icon-image": ["concat", "spr-", ["get", "shape"]],
          "icon-size": ["interpolate", ["linear"], ["zoom"], 9, 0.85, 13, 1.15, 16, 1.5, 18, 1.75],
          "icon-rotate": ["to-number", ["coalesce", ["get", "heading"], 0]],
          "icon-rotation-alignment": "map",
          "icon-pitch-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true
        }
      });
      // Everything else: a pin in the status colour, anchored at its tip.
      m.addLayer({
        id: "fleet-icons",
        type: "symbol",
        source: SRC,
        minzoom: DETAIL_ZOOM,
        filter: ["all", NOT_CLUSTER, ["!=", ["get", "state"], "moving"]] as never,
        layout: {
          "icon-image": ["concat", "pin-", ["get", "type"], "-", ["get", "state"]],
          "icon-anchor": "bottom",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "symbol-sort-key": ["match", ["get", "state"], "idle", 3, "stopped", 2, 1]
        }
      });
      // Names need glyphs; the production style has them, a bare style may not.
      if (m.getStyle().glyphs) {
        m.addLayer({
          id: "fleet-labels",
          type: "symbol",
          source: SRC,
          // Names only once vehicles are spread out; where cards would overlap, moving vehicles win and the rest hide.
          minzoom: 12,
          filter: NOT_CLUSTER as never,
          layout: {
            "text-field": ["format", ["get", "name"], { "font-scale": 1 }, ["case", ["==", ["get", "sub"], ""], "", ["concat", "\n", ["get", "sub"]]], { "font-scale": 0.85, "text-color": "#4b5563" }],
            "text-font": ["Noto Sans Regular"],
            "text-size": 12,
            "text-line-height": 1.25,
            "text-anchor": "top",
            "text-offset": ["case", ["==", ["get", "state"], "moving"], ["literal", [0, 1.9]], ["literal", [0, 0.6]]],
            "text-optional": true,
            "icon-image": "veh-chip",
            "icon-text-fit": "both",
            "icon-text-fit-padding": [3, 7, 3, 7],
            "symbol-sort-key": ["match", ["get", "state"], "moving", 1, "idle", 2, "stopped", 3, 4]
          },
          paint: { "text-color": "#0a2463" }
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
      for (const layer of ["fleet-icons", "fleet-moving", "fleet-dots"]) {
        m.on("click", layer, click);
        m.on("mousemove", layer, enter);
        m.on("mouseleave", layer, leave);
        this.handlers.push(() => {
          m.off("click", layer, click);
          m.off("mousemove", layer, enter);
          m.off("mouseleave", layer, leave);
        });
      }
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
    this.trails.clear();
    this.trailsDirty = true;
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
      if (p.state === "moving") {
        const prev = this.points.get(p.id);
        const tail = this.trails.get(p.id) ?? (prev ? [prev.lngLat] : []);
        tail.push(p.lngLat);
        this.trails.set(p.id, tail.slice(-TRAIL_POINTS));
      } else this.trails.delete(p.id);
      this.trailsDirty = true;
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
      this.trails.delete(id);
    }
    this.trailsDirty = true;
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

  /** Merge nearby vehicles into counted bubbles when zoomed out (on by default). */
  setClustering(on: boolean) {
    this.clustering = on;
    if (!this.ready) return;
    (this.map.getSource(SRC) as GeoJSONSource | undefined)?.setClusterOptions({ cluster: on, clusterMaxZoom: CLUSTER_MAX_ZOOM, clusterRadius: 48 });
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
    if (this.selected && !this.reduceMotion) {
      // A short "ping": the ring grows out from the marker so the eye finds the selection.
      this.map.setPaintProperty("fleet-halo", "circle-radius-transition", { duration: 0, delay: 0 });
      this.map.setPaintProperty("fleet-halo", "circle-radius", 13);
      requestAnimationFrame(() => {
        if (!this.ready || !this.map.getLayer("fleet-halo")) return;
        this.map.setPaintProperty("fleet-halo", "circle-radius-transition", { duration: 320, delay: 0 });
        this.map.setPaintProperty("fleet-halo", "circle-radius", HALO_R);
      });
    }
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
                  { key: "type", value: p.type },
                  { key: "heading", value: p.heading ?? 0 },
                  { key: "name", value: p.name },
                  { key: "shape", value: SHAPE_OF[p.type] },
                  { key: "sub", value: p.sub ?? "" }
                ]
              }
            ];
          })
        });
      }
    }
    if (this.trailsDirty || animating) {
      this.trailsDirty = false;
      const trailSrc = this.map.getSource(TRAILS) as GeoJSONSource | undefined;
      if (trailSrc) {
        const lines: GeoJSON.Feature<GeoJSON.LineString>[] = [];
        for (const [id, tail] of this.trails) {
          const p = this.points.get(id);
          if (!p || p.state !== "moving" || !this.passes(p)) continue;
          // The tail ends where the vehicle is drawn right now, so it never detaches while gliding.
          const pts = this.anims.has(id) ? [...tail.slice(0, -1), this.display.get(id)!] : tail;
          if (pts.length >= 2) lines.push({ type: "Feature", properties: { id }, geometry: { type: "LineString", coordinates: pts } });
        }
        trailSrc.setData({ type: "FeatureCollection", features: lines });
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
        properties: { id: p.id, name: p.name, state: p.state, type: p.type, shape: SHAPE_OF[p.type], sub: p.sub ?? "", heading: p.heading ?? 0 }
      });
    }
    return { type: "FeatureCollection", features };
  }
}
