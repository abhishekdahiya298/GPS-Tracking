import { describe, expect, it } from "vitest";
import type { FleetDevice } from "../fleet/model";
import { boundsOf, positionOf, readTap, toFeatures } from "./model";

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
