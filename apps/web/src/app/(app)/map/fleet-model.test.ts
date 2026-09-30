import { describe, expect, it } from "vitest";
import { bearing, indexAtTime, lerpLngLat, mapState, quickRange, shouldAnimate, trackStats } from "./fleet-model";

const now = Date.parse("2026-09-25T12:00:00Z");
const loc = (speedKph: number | null) => ({ latitude: 0, longitude: 0, speedKph, headingDeg: 0, altitudeM: null, ignition: null, motion: null, recordedAt: "2026-09-25T11:59:00Z", receivedAt: "2026-09-25T11:59:00Z" });

describe("fleet-model", () => {
  it("mapState: offline from last_seen, else moving/idle by speed", () => {
    expect(mapState({ lastSeenAt: "2026-09-25T11:59:00Z", location: loc(40) }, now, 600)).toBe("moving");
    expect(mapState({ lastSeenAt: "2026-09-25T11:59:00Z", location: loc(2) }, now, 600)).toBe("idle");
    expect(mapState({ lastSeenAt: "2026-09-25T11:40:00Z", location: loc(40) }, now, 600)).toBe("offline");
    expect(mapState({ lastSeenAt: null, location: null }, now, 600)).toBe("offline");
  });
  it("bearing", () => {
    expect(Math.round(bearing([0, 0], [0, 1]))).toBe(0);
    expect(Math.round(bearing([0, 0], [1, 0]))).toBe(90);
    expect(Math.round(bearing([0, 0], [0, -1]))).toBe(180);
  });
  it("lerp endpoints and animation guard", () => {
    expect(lerpLngLat([0, 0], [10, 20], 0)).toEqual([0, 0]);
    expect(lerpLngLat([0, 0], [10, 20], 1)).toEqual([10, 20]);
    expect(lerpLngLat([0, 0], [10, 20], 0.5)).toEqual([5, 10]);
    expect(shouldAnimate([-118, 34], [-118.001, 34])).toBe(true);
    expect(shouldAnimate([-118, 34], [-117, 34])).toBe(false); // ~92 km: teleport
    expect(shouldAnimate([-118, 34], [-118, 34])).toBe(false);
  });
  it("indexAtTime binary search", () => {
    const t = [10, 20, 30, 40];
    expect(indexAtTime(t, 5)).toBe(0);
    expect(indexAtTime(t, 20)).toBe(1);
    expect(indexAtTime(t, 29)).toBe(1);
    expect(indexAtTime(t, 99)).toBe(3);
    expect(indexAtTime([], 5)).toBe(0);
  });
  it("trackStats ignores GPS jumps", () => {
    const p = (lat: number, t: string, s = 30) => ({ ...loc(s), latitude: lat, recordedAt: t });
    const s = trackStats([p(0, "2026-09-25T10:00:00Z"), p(0.01, "2026-09-25T10:01:00Z", 60), p(5, "2026-09-25T10:02:00Z")]);
    expect(s.km).toBeCloseTo(1.11, 1);
    expect(s.maxKph).toBe(60);
    expect(s.cumKm[1]).toBeCloseTo(1.11, 1);
  });
  it("quickRange", () => {
    const n = new Date("2026-09-26T02:30:00Z"); // Sep 25, 10:30 PM in Toronto; Sep 26 in UTC
    expect(quickRange("today", "America/Toronto", n).from.toISOString()).toBe("2026-09-25T04:00:00.000Z");
    expect(quickRange("yesterday", "America/Toronto", n).to?.toISOString()).toBe("2026-09-25T04:00:00.000Z");
    expect(quickRange("yesterday", "America/Toronto", n).from.toISOString()).toBe("2026-09-24T04:00:00.000Z");
    expect(quickRange("7d", "America/Toronto", n).from.toISOString()).toBe("2026-09-19T04:00:00.000Z");
    expect(quickRange("today", "UTC", n).from.toISOString()).toBe("2026-09-26T00:00:00.000Z");
    // "Yesterday" across the fall-back change is 25 hours long
    const y = quickRange("yesterday", "America/Toronto", new Date("2026-11-02T15:00:00Z"));
    expect((y.to!.getTime() - y.from.getTime()) / 3600_000).toBe(25);
  });
});
