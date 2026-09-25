/** Planar-safe geometry helpers for geofencing (WGS84 degrees, meters). */

export type LonLat = [number, number];

export type GeofenceShape =
  | { kind: "circle"; center: LonLat; radiusM: number }
  | { kind: "polygon"; ring: LonLat[] };

const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineMeters(a: LonLat, b: LonLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Ray casting; the ring may be open or closed. Fine for fences that don't cross the antimeridian. */
export function pointInPolygon(p: LonLat, ring: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function insideGeofence(p: LonLat, shape: GeofenceShape): boolean {
  return shape.kind === "circle" ? haversineMeters(p, shape.center) <= shape.radiusM : pointInPolygon(p, shape.ring);
}

/** Approximates a circle as a closed polygon ring (for drawing on maps). */
export function circleRing(center: LonLat, radiusM: number, steps = 64): LonLat[] {
  const [lon0, lat0] = center;
  const dLat = (radiusM / R) * (180 / Math.PI);
  const dLon = dLat / Math.cos(rad(lat0));
  const ring: LonLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    ring.push([lon0 + dLon * Math.cos(t), lat0 + dLat * Math.sin(t)]);
  }
  return ring;
}

export function shapeRing(shape: GeofenceShape): LonLat[] {
  if (shape.kind === "circle") return circleRing(shape.center, shape.radiusM);
  const r = shape.ring;
  return r.length && (r[0]![0] !== r[r.length - 1]![0] || r[0]![1] !== r[r.length - 1]![1]) ? [...r, r[0]!] : r;
}
