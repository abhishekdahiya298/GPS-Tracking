import { describe, expect, it } from "vitest";
import { csvCell, detectTrips, summarizeByDay, type TrackPoint } from "./trips.js";

const T0 = Date.parse("2026-09-25T08:00:00Z");
const min = (m: number) => T0 + m * 60_000;
// ~0.009 deg lat ≈ 1 km
const pt = (m: number, km: number, speed: number | null, ign: boolean | null): TrackPoint => ({ t: min(m), lat: 43.6 + km * 0.009, lon: -79.7, speedKph: speed, ignition: ign });

describe("detectTrips", () => {
  it("splits on a 5+ minute stop and measures distance/duration", () => {
    const pts = [
      pt(0, 0, 0, false),
      pt(1, 0, 20, true), pt(2, 1, 60, true), pt(3, 2, 60, true), pt(4, 3, 0, true),
      pt(5, 3, 0, false), pt(12, 3, 0, false), // parked 8 min
      pt(13, 3, 30, true), pt(14, 4, 50, true), pt(15, 5, 0, true),
      pt(16, 5, 0, false)
    ];
    const trips = detectTrips(pts);
    expect(trips).toHaveLength(2);
    expect(trips[0]!.start.t).toBe(min(1));
    expect(trips[0]!.end.t).toBe(min(4));
    expect(trips[0]!.distanceM).toBeGreaterThan(2900);
    expect(trips[0]!.distanceM).toBeLessThan(3100);
    expect(trips[0]!.maxSpeedKph).toBe(60);
    expect(trips[1]!.start.t).toBe(min(13));
  });

  it("a short stop (< 5 min) with ignition off does not split a trip", () => {
    const pts = [pt(0, 0, 30, true), pt(1, 1, 30, true), pt(2, 1, 0, false), pt(4, 1, 0, false), pt(5, 1, 30, true), pt(6, 2, 30, true)];
    expect(detectTrips(pts)).toHaveLength(1);
  });

  it("a data gap > 20 min ends the trip", () => {
    const pts = [pt(0, 0, 30, true), pt(2, 1, 30, true), pt(40, 5, 30, true), pt(42, 6, 30, true)];
    expect(detectTrips(pts)).toHaveLength(2);
  });

  it("ignores GPS jumps and tiny noise trips", () => {
    const jump = [pt(0, 0, 30, true), pt(1, 1, 30, true), { ...pt(2, 1, 30, true), lat: 50 }, pt(3, 2, 30, true)];
    const [t] = detectTrips(jump);
    expect(t!.distanceM).toBeLessThan(2100);
    const noise = [pt(0, 0, 0, true), { ...pt(0.5, 0.01, 0, true) }];
    expect(detectTrips(noise)).toHaveLength(0);
  });

  it("sparse reporting while driving (5+ min between moving points) stays one trip", () => {
    const pts = [pt(0, 0, 50, true), pt(6, 5, 50, true), pt(12, 10, 50, true), pt(13, 10, 0, false)];
    expect(detectTrips(pts)).toHaveLength(1);
  });

  it("falls back to speed when ignition is unknown", () => {
    const pts = [pt(0, 0, 0, null), pt(1, 0, 40, null), pt(2, 1, 40, null), pt(3, 2, 40, null), pt(10, 2, 0, null)];
    expect(detectTrips(pts)).toHaveLength(1);
  });
});

describe("summarizeByDay", () => {
  it("attributes trips to the local day they start", () => {
    const late = Date.parse("2026-09-25T03:30:00Z"); // 23:30 previous day in Toronto (UTC-4)
    const trips = detectTrips([
      { t: late, lat: 43.6, lon: -79.7, speedKph: 30, ignition: true },
      { t: late + 600_000, lat: 43.61, lon: -79.7, speedKph: 30, ignition: true }
    ]);
    expect(summarizeByDay(trips, "America/Toronto")[0]!.day).toBe("2026-09-24");
    expect(summarizeByDay(trips, "UTC")[0]!.day).toBe("2026-09-25");
  });
});

describe("csvCell", () => {
  it("neutralizes formulas and quotes separators", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(null)).toBe("");
  });
});
