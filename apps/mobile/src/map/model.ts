/**
 * Pure helpers for the live map: what goes on the map and where the camera should look.
 * No map-library imports, so this is unit-tested.
 */
import { STATE_META, displayName, fleetState, type FleetDevice, type FleetState } from "../fleet/model";

export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
/** Southern Ontario, shown until the first positions arrive. */
export const DEFAULT_CENTER: [number, number] = [-79.64, 43.59];
export const DEFAULT_ZOOM = 8;

export interface VehicleProps {
  deviceId: string;
  name: string;
  state: FleetState;
  color: string;
  heading: number;
}
export type VehicleFeature = GeoJSON.Feature<GeoJSON.Point, VehicleProps>;

const hasFix = (d: FleetDevice): d is FleetDevice & { location: NonNullable<FleetDevice["location"]> } =>
  !!d.location && Number.isFinite(d.location.latitude) && Number.isFinite(d.location.longitude) && !(d.location.latitude === 0 && d.location.longitude === 0);

/** One point per tracker that has ever reported a real position. */
export function toFeatures(devices: FleetDevice[]): GeoJSON.FeatureCollection<GeoJSON.Point, VehicleProps> {
  return {
    type: "FeatureCollection",
    features: devices.filter(hasFix).map((d) => {
      const state = fleetState(d);
      return {
        type: "Feature",
        id: d.deviceId,
        geometry: { type: "Point", coordinates: [d.location.longitude, d.location.latitude] },
        properties: { deviceId: d.deviceId, name: displayName(d), state, color: STATE_META[state].color, heading: d.location.headingDeg ?? 0 }
      };
    })
  };
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
