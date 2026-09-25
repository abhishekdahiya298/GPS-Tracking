import { describe, expect, it } from "vitest";
import { haversineMeters, insideGeofence, pointInPolygon, type LonLat } from "./geo.js";

const square: LonLat[] = [[-79.8, 43.6], [-79.7, 43.6], [-79.7, 43.7], [-79.8, 43.7]];

describe("geo", () => {
  it("haversine ≈ 111 km per degree of latitude", () => {
    expect(haversineMeters([0, 0], [0, 1])).toBeGreaterThan(111_000);
    expect(haversineMeters([0, 0], [0, 1])).toBeLessThan(111_400);
  });
  it("point in polygon (open or closed ring)", () => {
    expect(pointInPolygon([-79.75, 43.65], square)).toBe(true);
    expect(pointInPolygon([-79.65, 43.65], square)).toBe(false);
    expect(pointInPolygon([-79.75, 43.65], [...square, square[0]!])).toBe(true);
  });
  it("concave polygon", () => {
    const u: LonLat[] = [[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3]];
    expect(pointInPolygon([1.5, 2], u)).toBe(false);
    expect(pointInPolygon([0.5, 2], u)).toBe(true);
  });
  it("circle", () => {
    const c = { kind: "circle" as const, center: [-79.7, 43.6] as LonLat, radiusM: 500 };
    expect(insideGeofence([-79.7, 43.6039], c)).toBe(true); // ~434 m
    expect(insideGeofence([-79.7, 43.6050], c)).toBe(false); // ~556 m
  });
});

describe("circleRing", () => {
  it("is closed and every vertex is ~radius from the center", async () => {
    const { circleRing } = await import("./geo.js");
    const ring = circleRing([-79.7, 43.6], 1000, 32);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const p of ring) expect(Math.abs(haversineMeters(p, [-79.7, 43.6]) - 1000)).toBeLessThan(15);
  });
});
