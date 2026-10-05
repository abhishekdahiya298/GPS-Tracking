import { describe, expect, it } from "vitest";
import { detectIdling, detectSpeeding, detectStops, mileageByDay } from "./activity.js";
import { detectTrips, type TrackPoint } from "./trips.js";

const T0 = Date.parse("2026-09-25T08:00:00Z");
const min = (m: number) => T0 + m * 60_000;
// ~0.009 deg lat ≈ 1 km
const pt = (m: number, km: number, speed: number | null, ign: boolean | null): TrackPoint => ({ t: min(m), lat: 43.6 + km * 0.009, lon: -79.7, speedKph: speed, ignition: ign });

// drive 0-4 min, parked 8 min, drive 13-15 min, parked after
const twoTrips = [
  pt(0, 0, 0, false),
  pt(1, 0, 20, true), pt(2, 1, 60, true), pt(3, 2, 60, true), pt(4, 3, 0, true),
  pt(5, 3, 0, false), pt(12, 3, 0, false),
  pt(13, 3, 30, true), pt(14, 4, 50, true), pt(15, 5, 0, true),
  pt(16, 5, 0, false)
];

describe("detectStops", () => {
  const trips = detectTrips(twoTrips);
  it("a stop is the time between two trips, at the place the first one ended", () => {
    const stops = detectStops(trips, min(60), 5);
    expect(stops).toHaveLength(2);
    expect(stops[0]).toMatchObject({ startT: min(4), endT: min(13), durationS: 9 * 60 });
    expect(stops[0]!.lat).toBeCloseTo(43.6 + 3 * 0.009, 6);
  });
  it("the last stop is ongoing and lasts until the end of the range", () => {
    const last = detectStops(trips, min(60), 5).at(-1)!;
    expect(last).toMatchObject({ startT: min(15), endT: null, durationS: 45 * 60 });
  });
  it("minimum duration filters short stops; no trips means no stops", () => {
    expect(detectStops(trips, min(60), 10)).toHaveLength(1);
    expect(detectStops(trips, min(17), 5)).toHaveLength(1); // the trailing 2 minutes are too short
    expect(detectStops([], min(60), 5)).toEqual([]);
  });
});

describe("detectIdling", () => {
  it("ignition on and not moving, until the vehicle moves", () => {
    const pts = [pt(0, 0, 40, true), pt(1, 1, 0, true), pt(4, 1, 0, true), pt(9, 1, 1, true), pt(10, 1, 30, true), pt(11, 2, 40, true)];
    const idle = detectIdling(pts, 5);
    expect(idle).toHaveLength(1);
    expect(idle[0]).toMatchObject({ startT: min(1), endT: min(10), durationS: 9 * 60 });
  });
  it("ends when the ignition turns off; engine-off time is not idling", () => {
    const pts = [pt(0, 0, 0, true), pt(6, 0, 0, true), pt(7, 0, 0, false), pt(30, 0, 0, false)];
    expect(detectIdling(pts, 5)).toEqual([expect.objectContaining({ startT: min(0), endT: min(7), durationS: 7 * 60 })]);
  });
  it("never counts missing data: a gap ends the period at the last idle point", () => {
    const pts = [pt(0, 0, 0, true), pt(6, 0, 0, true), pt(120, 0, 0, true), pt(121, 0, 0, true)];
    const idle = detectIdling(pts, 5);
    expect(idle).toHaveLength(1);
    expect(idle[0]).toMatchObject({ startT: min(0), endT: min(6) });
  });
  it("unknown ignition never counts; short periods are filtered", () => {
    expect(detectIdling([pt(0, 0, 0, null), pt(30, 0, 0, null)], 5)).toEqual([]);
    expect(detectIdling([pt(0, 0, 0, true), pt(3, 0, 0, true), pt(4, 0, 30, true)], 5)).toEqual([]);
  });
});

describe("detectSpeeding", () => {
  const pts = [pt(0, 0, 90, true), pt(1, 2, 112, true), pt(2, 4, 128, true), pt(3, 6, 119, true), pt(4, 8, 100, true), pt(5, 10, 111, true), pt(6, 12, 80, true)];
  it("one event per continuous stretch above the limit, with top speed and its place", () => {
    const ev = detectSpeeding(pts, 110);
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ startT: min(1), endT: min(3), durationS: 120, maxSpeedKph: 128, points: 3 });
    expect(ev[0]!.lat).toBeCloseTo(43.6 + 4 * 0.009, 6);
    expect(ev[1]).toMatchObject({ startT: min(5), endT: min(5), durationS: 0, points: 1 }); // single reading
  });
  it("exactly at the limit is not speeding; GPS glitches are ignored; gaps split events", () => {
    expect(detectSpeeding(pts, 128)).toEqual([]);
    expect(detectSpeeding([pt(0, 0, 400, true)], 110)).toEqual([]);
    expect(detectSpeeding([pt(0, 0, 120, true), pt(60, 50, 120, true)], 110)).toHaveLength(2);
    expect(detectSpeeding([pt(0, 0, null, true)], 110)).toEqual([]);
  });
});

describe("mileageByDay", () => {
  it("totals equal the trip totals", () => {
    const days = mileageByDay(twoTrips, "UTC");
    const trips = detectTrips(twoTrips);
    expect(days).toHaveLength(1);
    expect(days[0]!.trips).toBe(2);
    expect(Math.abs(days[0]!.distanceM - trips.reduce((a, t) => a + t.distanceM, 0))).toBeLessThanOrEqual(1);
    expect(days[0]!.drivingS).toBe(trips.reduce((a, t) => a + t.movingS, 0));
    expect(days[0]!.maxSpeedKph).toBe(60);
  });
  it("a trip across local midnight is split between both days", () => {
    // 03:50Z–04:10Z on Sep 26 is 11:50 PM Sep 25 → 12:10 AM Sep 26 in Toronto (EDT)
    const base = Date.parse("2026-09-26T03:50:00Z");
    const pts: TrackPoint[] = Array.from({ length: 21 }, (_, i) => ({ t: base + i * 60_000, lat: 43.6 + i * 0.009, lon: -79.7, speedKph: 60, ignition: true }));
    const tor = mileageByDay(pts, "America/Toronto");
    expect(tor.map((d) => d.day)).toEqual(["2026-09-25", "2026-09-26"]);
    expect(tor[0]!.distanceM).toBeGreaterThan(9_900);
    expect(tor[0]!.distanceM).toBeLessThan(10_100);
    expect(tor[1]!.distanceM).toBeGreaterThan(9_900);
    expect(tor.map((d) => d.trips)).toEqual([1, 0]); // the trip is counted on the day it started
    expect(mileageByDay(pts, "UTC").map((d) => d.day)).toEqual(["2026-09-26"]);
  });
  it("no trips, no rows", () => {
    expect(mileageByDay([pt(0, 0, 0, false), pt(60, 0, 0, false)], "UTC")).toEqual([]);
  });
});
