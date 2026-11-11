/**
 * Pure helpers for the live map: what goes on the map and where the camera should look.
 * No map-library imports, so this is unit-tested.
 */
import { STATE_META, displayName, fleetState, type FleetDevice, type FleetState } from "../fleet/model";

/** The same three base maps as the website (lib/map-style.ts). */
export const MAP_STYLES = [
  { id: "streets", label: "Streets", url: "https://tiles.openfreemap.org/styles/liberty" },
  { id: "light", label: "Light", url: "https://tiles.openfreemap.org/styles/positron" },
  { id: "dark", label: "Dark", url: "https://tiles.openfreemap.org/styles/dark" }
] as const;
export type MapStyleId = (typeof MAP_STYLES)[number]["id"];
export const isMapStyleId = (v: unknown): v is MapStyleId => MAP_STYLES.some((m) => m.id === v);
export const styleUrl = (id: MapStyleId): string => MAP_STYLES.find((m) => m.id === id)!.url;
export const MAP_STYLE_URL = styleUrl("streets");

/** From this zoom vehicles are drawn as pictures with a name; below it as status dots (as on the website). */
export const DETAIL_ZOOM = 11;

/** Top-down picture per kind of vehicle. Matches the website's SHAPE_OF. */
export type VehicleShape = "car" | "van" | "truck" | "trailer";
const SHAPES: Record<string, VehicleShape> = { car: "car", pickup: "car", other: "car", van: "van", bus: "truck", truck: "truck", semi: "truck", equipment: "truck", trailer: "trailer" };
export const shapeOf = (type: string | null | undefined): VehicleShape => SHAPES[type ?? ""] ?? "car";

/** The picture's colour group: parked trailers look like stopped vehicles, never-seen like offline. */
const spriteState = (s: FleetState): "moving" | "idle" | "stopped" | "offline" => (s === "parked" ? "stopped" : s === "never_seen" ? "offline" : s);
/** Name of the map image for a vehicle, e.g. "veh-truck-moving". The files are in assets/map. */
export const spriteName = (type: string | null | undefined, state: FleetState): string => `veh-${shapeOf(type)}-${spriteState(state)}`;
/** Southern Ontario, shown until the first positions arrive. */
export const DEFAULT_CENTER: [number, number] = [-79.64, 43.59];
export const DEFAULT_ZOOM = 8;

export interface VehicleProps {
  deviceId: string;
  name: string;
  state: FleetState;
  color: string;
  heading: number;
  /** Map image to draw at close zoom. */
  icon: string;
  /** Second line under the name: "62 mph", "Idling", "Parked" … */
  sub: string;
}
export type VehicleFeature = GeoJSON.Feature<GeoJSON.Point, VehicleProps>;

const hasFix = (d: FleetDevice): d is FleetDevice & { location: NonNullable<FleetDevice["location"]> } =>
  !!d.location && Number.isFinite(d.location.latitude) && Number.isFinite(d.location.longitude) && !(d.location.latitude === 0 && d.location.longitude === 0);

const SUB: Record<FleetState, string> = { moving: "Moving", idle: "Idling", stopped: "Stopped", parked: "Parked", offline: "Offline", never_seen: "No data" };

/**
 * One point per tracker that has ever reported a real position.
 * `shown` overrides where a vehicle is drawn (while it glides between two reports) and
 * `headings` the way it points (worked out from its movement when the tracker sends none).
 */
export function toFeatures(
  devices: FleetDevice[],
  fmtSpeed?: (kph: number | null) => string,
  shown?: ReadonlyMap<string, [number, number]>,
  headings?: ReadonlyMap<string, number>
): GeoJSON.FeatureCollection<GeoJSON.Point, VehicleProps> {
  return {
    type: "FeatureCollection",
    features: devices.filter(hasFix).map((d) => {
      const state = fleetState(d);
      return {
        type: "Feature",
        id: d.deviceId,
        geometry: { type: "Point", coordinates: shown?.get(d.deviceId) ?? [d.location.longitude, d.location.latitude] },
        properties: {
          deviceId: d.deviceId,
          name: displayName(d),
          state,
          color: STATE_META[state].color,
          heading: d.location.headingDeg ?? headings?.get(d.deviceId) ?? 0,
          icon: spriteName(d.vehicle?.type, state),
          sub: state === "moving" && fmtSpeed ? fmtSpeed(d.location.speedKph) : SUB[state]
        }
      };
    })
  };
}

// ---------- smooth movement (display only; GPS data is never changed) ----------

const rad = (deg: number) => (deg * Math.PI) / 180;

export function distanceKm(a: [number, number], b: [number, number]): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Direction of travel from a to b in degrees (0 = north). */
export function bearing(a: [number, number], b: [number, number]): number {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Where to draw a vehicle part-way (t from 0 to 1) between two reports, easing in and out. */
export function lerpLngLat(from: [number, number], to: [number, number], t: number): [number, number] {
  const k = ease(Math.max(0, Math.min(1, t)));
  return [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k];
}

/** Glide only for believable short moves; jump otherwise (first report, or after a long gap). */
export function shouldAnimate(from: [number, number], to: [number, number]): boolean {
  const km = distanceKm(from, to);
  return km > 0.002 && km < 5;
}

// ---------- trails ----------

export const TRAIL_POINTS = 8;
export type Trails = ReadonlyMap<string, ReadonlyArray<[number, number]>>;

/**
 * The last few real positions of each moving vehicle. A vehicle that stops, goes offline or
 * jumps far (a gap in reporting) loses its trail, so a line never cuts across the map.
 */
export function nextTrails(prev: Trails, devices: FleetDevice[]): Map<string, Array<[number, number]>> {
  const next = new Map<string, Array<[number, number]>>();
  for (const d of devices) {
    if (!hasFix(d) || fleetState(d) !== "moving") continue;
    const at: [number, number] = [d.location.longitude, d.location.latitude];
    const old = prev.get(d.deviceId) ?? [];
    const last = old[old.length - 1];
    if (!last) next.set(d.deviceId, [at]);
    else if (last[0] === at[0] && last[1] === at[1]) next.set(d.deviceId, [...old]);
    else if (!shouldAnimate(last, at)) next.set(d.deviceId, [at]);
    else next.set(d.deviceId, [...old, at].slice(-TRAIL_POINTS));
  }
  return next;
}

/** Trail lines for the map. `shown` moves each line's end to where the vehicle is drawn right now. */
export function trailFeatures(trails: Trails, shown?: ReadonlyMap<string, [number, number]>): GeoJSON.FeatureCollection<GeoJSON.LineString, { deviceId: string }> {
  const features: Array<GeoJSON.Feature<GeoJSON.LineString, { deviceId: string }>> = [];
  for (const [deviceId, points] of trails) {
    const tip = shown?.get(deviceId);
    const coordinates = tip && points.length > 0 ? [...points.slice(0, -1), tip] : [...points];
    if (coordinates.length >= 2) features.push({ type: "Feature", geometry: { type: "LineString", coordinates }, properties: { deviceId } });
  }
  return { type: "FeatureCollection", features };
}

// ---------- zones ----------

export type ZoneShape = { kind: "circle"; center: [number, number]; radiusM: number } | { kind: "polygon"; ring: Array<[number, number]> };
export interface Zone {
  id: string;
  name: string;
  color: string;
  shape: ZoneShape;
}

/** A circle as a closed ring of points, for drawing. Same maths as the website (packages/core geo.ts). */
export function circleRing(center: [number, number], radiusM: number, steps = 48): Array<[number, number]> {
  const [lon0, lat0] = center;
  const dLat = (radiusM / 6_371_008.8) * (180 / Math.PI);
  const dLon = dLat / Math.max(0.01, Math.cos(rad(lat0)));
  const ring: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([lon0 + dLon * Math.sin(a), lat0 + dLat * Math.cos(a)]);
  }
  return ring;
}

const validPoint = (p: unknown): p is [number, number] => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/** Zones as filled shapes. Anything the server sends that can't be drawn is skipped, not crashed on. */
export function zoneFeatures(zones: Zone[]): GeoJSON.FeatureCollection<GeoJSON.Polygon, { id: string; name: string; color: string }> {
  const features: Array<GeoJSON.Feature<GeoJSON.Polygon, { id: string; name: string; color: string }>> = [];
  for (const z of zones) {
    let ring: Array<[number, number]> | null = null;
    if (z.shape?.kind === "circle" && validPoint(z.shape.center) && Number.isFinite(z.shape.radiusM) && z.shape.radiusM > 0) ring = circleRing(z.shape.center, z.shape.radiusM);
    else if (z.shape?.kind === "polygon" && Array.isArray(z.shape.ring)) {
      const points = z.shape.ring.filter(validPoint);
      if (points.length >= 3) {
        const [first, last] = [points[0]!, points[points.length - 1]!];
        ring = first[0] === last[0] && first[1] === last[1] ? points : [...points, first];
      }
    }
    if (ring) features.push({ type: "Feature", id: z.id, geometry: { type: "Polygon", coordinates: [ring] }, properties: { id: z.id, name: z.name, color: /^#[0-9a-f]{6}$/i.test(z.color) ? z.color : "#133a8f" } });
  }
  return { type: "FeatureCollection", features };
}

export function positionOf(d: FleetDevice | undefined): [number, number] | null {
  return d && hasFix(d) ? [d.location.longitude, d.location.latitude] : null;
}

/**
 * The box that contains every vehicle, as [west, south, east, north], or null with no positions.
 * A single vehicle (or several parked together) gets a box about 2 km wide, not a point.
 */
export function boundsOf(devices: FleetDevice[], minSpanDeg = 0.02): [number, number, number, number] | null {
  const points = devices.filter(hasFix).map((d) => [d.location.longitude, d.location.latitude] as const);
  if (points.length === 0) return null;
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const [lng, lat] of points) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  if (east - west < minSpanDeg) {
    const mid = (east + west) / 2;
    west = mid - minSpanDeg / 2;
    east = mid + minSpanDeg / 2;
  }
  if (north - south < minSpanDeg) {
    const mid = (north + south) / 2;
    south = mid - minSpanDeg / 2;
    north = mid + minSpanDeg / 2;
  }
  return [west, south, east, north];
}

/** Close enough to see the road a vehicle is on. */
export const FOCUS_ZOOM = 14.5;
/** Zoom to use when a vehicle is tapped: come in close, but never zoom out if the person is already closer. */
export const focusZoom = (current: number | null | undefined): number => (typeof current === "number" && Number.isFinite(current) ? Math.max(current, FOCUS_ZOOM) : FOCUS_ZOOM);

/** What a tap on the map hit: a group of vehicles, one vehicle, or nothing. */
export function readTap(features: GeoJSON.Feature[] | undefined): { kind: "cluster"; clusterId: number; at: [number, number] } | { kind: "vehicle"; deviceId: string } | { kind: "none" } {
  const f = features?.[0];
  const p = f?.properties as Record<string, unknown> | null | undefined;
  if (!f || !p) return { kind: "none" };
  if (p.cluster === true || p.cluster === "true" || typeof p.cluster_id === "number") {
    const at = f.geometry?.type === "Point" ? (f.geometry.coordinates as [number, number]) : null;
    return typeof p.cluster_id === "number" && at ? { kind: "cluster", clusterId: p.cluster_id, at } : { kind: "none" };
  }
  return typeof p.deviceId === "string" ? { kind: "vehicle", deviceId: p.deviceId } : { kind: "none" };
}
