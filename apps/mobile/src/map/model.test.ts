import { describe, expect, it } from "vitest";
import type { FleetDevice } from "../fleet/model";
import { FOCUS_ZOOM, MAP_STYLES, focusZoom, TRAIL_POINTS, bearing, boundsOf, distanceKm, isMapStyleId, lerpLngLat, nextTrails, positionOf, readTap, shapeOf, shouldAnimate, spriteName, styleUrl, toFeatures, trailFeatures, zoneFeatures, type Zone } from "./model";

const dev = (id: string, lat: number | null, lng: number | null, over: Partial<FleetDevice> = {}): FleetDevice => ({
  deviceId: id, model: "FTM880", name: null, deviceStatus: "active", vehicle: { id, name: `Truck ${id}`, licensePlate: null, type: "truck" }, connectivity: "online", lastSeenAt: "2026-10-09T12:00:00Z",
  location: lat === null || lng === null ? null : { latitude: lat, longitude: lng, speedKph: 60, headingDeg: 90, altitudeM: null, ignition: true, motion: true, recordedAt: "2026-10-09T12:00:00Z", receivedAt: "2026-10-09T12:00:01Z" },
  ...over
});

describe("map features", () => {
  it("makes one point per tracker with a real position, coloured by status", () => {
    const fc = toFeatures([dev("1", 43.5, -79.6), dev("2", null, null), dev("3", 0, 0), dev("4", 43.6, -79.7, { connectivity: "offline" })]);
    expect(fc.features.map((f) => f.properties.deviceId)).toEqual(["1", "4"]);
    expect(fc.features[0]!.geometry.coordinates).toEqual([-79.6, 43.5]);
    expect(fc.features[0]!.properties).toMatchObject({ name: "Truck 1", state: "moving", color: "#15803d", heading: 90 });
    expect(fc.features[1]!.properties.state).toBe("offline");
  });
  it("gives a position only when there is one", () => {
    expect(positionOf(dev("1", 43.5, -79.6))).toEqual([-79.6, 43.5]);
    expect(positionOf(dev("2", null, null))).toBeNull();
    expect(positionOf(undefined)).toBeNull();
  });
});

describe("camera bounds", () => {
  it("is null with no positions", () => {
    expect(boundsOf([dev("1", null, null)])).toBeNull();
  });
  it("contains every vehicle as west, south, east, north", () => {
    expect(boundsOf([dev("1", 43.5, -79.6), dev("2", 45.4, -75.7), dev("3", 42.3, -83.0)])).toEqual([-83.0, 42.3, -75.7, 45.4]);
  });
  it("widens a single vehicle to a small box around it", () => {
    const [w, s, e, n] = boundsOf([dev("1", 43.5, -79.6)])!;
    expect(e - w).toBeCloseTo(0.02);
    expect(n - s).toBeCloseTo(0.02);
    expect((w + e) / 2).toBeCloseTo(-79.6);
    expect((s + n) / 2).toBeCloseTo(43.5);
  });
});

describe("reading a tap", () => {
  const point = (properties: Record<string, unknown>): GeoJSON.Feature => ({ type: "Feature", geometry: { type: "Point", coordinates: [-79.6, 43.5] }, properties });
  it("tells a group, a vehicle and empty map apart", () => {
    expect(readTap([point({ cluster: true, cluster_id: 7, point_count: 3 })])).toEqual({ kind: "cluster", clusterId: 7, at: [-79.6, 43.5] });
    expect(readTap([point({ deviceId: "abc", name: "Truck 1" })])).toEqual({ kind: "vehicle", deviceId: "abc" });
    expect(readTap([])).toEqual({ kind: "none" });
    expect(readTap(undefined)).toEqual({ kind: "none" });
    expect(readTap([point({ something: "else" })])).toEqual({ kind: "none" });
  });
});

describe("vehicle pictures and labels", () => {
  it("picks the picture by kind of vehicle and status", () => {
    expect(shapeOf("semi")).toBe("truck");
    expect(shapeOf("pickup")).toBe("car");
    expect(shapeOf(undefined)).toBe("car");
    expect(spriteName("trailer", "parked")).toBe("veh-trailer-stopped");
    expect(spriteName("van", "never_seen")).toBe("veh-van-offline");
    const f = toFeatures([dev("1", 43.5, -79.6)], (k) => `${Math.round(k ?? 0)} km/h`).features[0]!;
    expect(f.properties.icon).toBe("veh-truck-moving");
    expect(f.properties.sub).toBe("60 km/h");
    expect(toFeatures([dev("1", 43.5, -79.6, { connectivity: "offline" })]).features[0]!.properties.sub).toBe("Offline");
  });
  it("draws a gliding vehicle where it is shown, and points it along its movement when the tracker sends no heading", () => {
    const d = dev("1", 43.5, -79.6);
    d.location!.headingDeg = null;
    const f = toFeatures([d], undefined, new Map([["1", [-79.61, 43.51]]]), new Map([["1", 270]])).features[0]!;
    expect(f.geometry.coordinates).toEqual([-79.61, 43.51]);
    expect(f.properties.heading).toBe(270);
  });
  it("knows the three base maps", () => {
    expect(MAP_STYLES.map((m) => m.id)).toEqual(["streets", "light", "dark"]);
    expect(isMapStyleId("dark")).toBe(true);
    expect(isMapStyleId("satellite")).toBe(false);
    expect(styleUrl("streets")).toContain("liberty");
  });
});

describe("smooth movement", () => {
  it("works out direction and distance", () => {
    expect(Math.round(bearing([-79, 43], [-79, 44]))).toBe(0);
    expect(Math.round(bearing([-79, 43], [-78, 43]))).toBe(90);
    expect(Math.round(distanceKm([-79, 43], [-79, 44]))).toBe(111);
  });
  it("eases between two reports and clamps outside 0..1", () => {
    expect(lerpLngLat([0, 0], [10, 10], 0)).toEqual([0, 0]);
    expect(lerpLngLat([0, 0], [10, 10], 0.5)).toEqual([5, 5]);
    expect(lerpLngLat([0, 0], [10, 10], 2)).toEqual([10, 10]);
  });
  it("glides short moves but jumps for no move or a long gap", () => {
    expect(shouldAnimate([-79, 43], [-79, 43.005])).toBe(true);
    expect(shouldAnimate([-79, 43], [-79, 43])).toBe(false);
    expect(shouldAnimate([-79, 43], [-79, 44])).toBe(false);
  });
});

describe("trails", () => {
  it("grows a trail while a vehicle moves, keeps it short, and drops it when the vehicle stops", () => {
    let trails = nextTrails(new Map(), [dev("1", 43.5, -79.6)]);
    expect(trailFeatures(trails).features).toHaveLength(0); // one point is not a line yet
    trails = nextTrails(trails, [dev("1", 43.501, -79.6)]);
    trails = nextTrails(trails, [dev("1", 43.501, -79.6)]); // same report again: no duplicate point
    expect(trails.get("1")).toHaveLength(2);
    for (let i = 2; i < 20; i++) trails = nextTrails(trails, [dev("1", 43.5 + i / 1000, -79.6)]);
    expect(trails.get("1")).toHaveLength(TRAIL_POINTS);
    const stopped = dev("1", 43.52, -79.6);
    stopped.location!.speedKph = 0;
    expect(nextTrails(trails, [stopped]).has("1")).toBe(false);
  });
  it("starts a new trail after a big jump, and ends the line where the vehicle is drawn", () => {
    let trails = nextTrails(new Map(), [dev("1", 43.5, -79.6)]);
    trails = nextTrails(trails, [dev("1", 43.501, -79.6)]);
    expect(nextTrails(trails, [dev("1", 45, -79.6)]).get("1")).toEqual([[-79.6, 45]]);
    const line = trailFeatures(trails, new Map([["1", [-79.6, 43.5005]]])).features[0]!;
    expect(line.geometry.coordinates).toEqual([[-79.6, 43.5], [-79.6, 43.5005]]);
  });
});

describe("zones", () => {
  it("turns circles and polygons into closed shapes", () => {
    const zones: Zone[] = [
      { id: "a", name: "Yard", color: "#ff0000", shape: { kind: "circle", center: [-79.6, 43.5], radiusM: 500 } },
      { id: "b", name: "Depot", color: "nope", shape: { kind: "polygon", ring: [[-79, 43], [-79, 44], [-78, 44]] } }
    ];
    const fc = zoneFeatures(zones);
    expect(fc.features).toHaveLength(2);
    const circle = fc.features[0]!.geometry.coordinates[0]!;
    expect(circle[0]).toEqual(circle[circle.length - 1]);
    expect(Math.round(distanceKm([-79.6, 43.5], circle[0] as [number, number]) * 1000)).toBe(500);
    const poly = fc.features[1]!.geometry.coordinates[0]!;
    expect(poly).toHaveLength(4);
    expect(fc.features[1]!.properties.color).toBe("#133a8f"); // bad colour falls back to brand blue
  });
  it("skips zones it can't draw instead of failing", () => {
    const bad = [
      { id: "x", name: "x", color: "#000000", shape: { kind: "polygon", ring: [[-79, 43]] } },
      { id: "y", name: "y", color: "#000000", shape: { kind: "circle", center: [NaN, 43], radiusM: 100 } },
      { id: "z", name: "z", color: "#000000", shape: null }
    ] as unknown as Zone[];
    expect(zoneFeatures(bad).features).toHaveLength(0);
  });
});

describe("tapping a vehicle", () => {
  it("zooms in close, and never out when already closer", () => {
    expect(focusZoom(6)).toBe(FOCUS_ZOOM);
    expect(focusZoom(17)).toBe(17);
    expect(focusZoom(null)).toBe(FOCUS_ZOOM);
    expect(focusZoom(NaN)).toBe(FOCUS_ZOOM);
  });
});

describe("large fleets", () => {
  it("prepares 1,000 vehicles for the map quickly", () => {
    const fleet = Array.from({ length: 1000 }, (_, i) => dev(`d${i}`, 40 + (i % 100) / 10, -90 + (i % 200) / 10));
    let trails = nextTrails(new Map(), fleet);
    const started = performance.now();
    for (let round = 0; round < 20; round++) {
      const moved = fleet.map((d, i) => dev(d.deviceId, 40 + (i % 100) / 10 + (round + 1) / 1000, -90 + (i % 200) / 10));
      trails = nextTrails(trails, moved);
      const features = toFeatures(moved, (k) => `${Math.round(k ?? 0)} km/h`);
      expect(features.features).toHaveLength(1000);
      trailFeatures(trails);
      boundsOf(moved);
    }
    // 20 full updates of 1,000 vehicles. On a laptop this takes a few tens of milliseconds;
    // the limit is loose so a slow test machine does not fail it.
    expect(performance.now() - started).toBeLessThan(2000);
    expect(trails.size).toBe(1000);
  });
});
