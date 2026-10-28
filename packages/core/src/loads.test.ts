import { describe, expect, it } from "vitest";
import { estimateLoadEta, isLoadPositionStale, nextLoadStatus, type LoadStop } from "./loads.js";

// Pickup in Toronto, delivery in Montreal (about 504 km apart in a straight line).
const pickup: LoadStop = { latitude: 43.6532, longitude: -79.3832, radiusM: 500 };
const delivery: LoadStop = { latitude: 45.5019, longitude: -73.5674, radiusM: 500 };
const at = (lat: number, lon: number, accuracyM: number | null = 20) => ({ latitude: lat, longitude: lon, accuracyM });
/** About `m` meters north of a stop. */
const north = (s: LoadStop, m: number, accuracyM: number | null = 20) => at(s.latitude + m / 111_195, s.longitude, accuracyM);

describe("nextLoadStatus", () => {
  it("walks the whole trip forward", () => {
    let s = nextLoadStatus("tracking", north(pickup, 5_000), pickup, delivery);
    expect(s).toEqual({ status: "tracking", events: [] });
    s = nextLoadStatus("tracking", north(pickup, 100), pickup, delivery);
    expect(s).toEqual({ status: "at_pickup", events: ["arrived_pickup"] });
    s = nextLoadStatus("at_pickup", north(pickup, 2_000), pickup, delivery);
    expect(s).toEqual({ status: "in_transit", events: ["departed_pickup"] });
    s = nextLoadStatus("in_transit", north(delivery, 300), pickup, delivery);
    expect(s).toEqual({ status: "at_delivery", events: ["arrived_delivery"] });
    s = nextLoadStatus("at_delivery", north(delivery, 1_000), pickup, delivery);
    expect(s).toEqual({ status: "delivered", events: ["departed_delivery", "delivered"] });
  });

  it("does not flap at the edge of a stop", () => {
    // Just outside the radius but within the exit margin (500 m × 1.2 = 600 m).
    expect(nextLoadStatus("at_pickup", north(pickup, 550), pickup, delivery).status).toBe("at_pickup");
    expect(nextLoadStatus("at_delivery", north(delivery, 580), pickup, delivery).status).toBe("at_delivery");
  });

  it("ignores imprecise positions but trusts trackers without an accuracy", () => {
    expect(nextLoadStatus("tracking", north(pickup, 0, 2_000), pickup, delivery).events).toEqual([]);
    expect(nextLoadStatus("tracking", north(pickup, 0, null), pickup, delivery).status).toBe("at_pickup");
  });

  it("records what was seen when a stage is skipped", () => {
    expect(nextLoadStatus("tracking", north(delivery, 0), pickup, delivery)).toEqual({ status: "at_delivery", events: ["arrived_delivery"] });
    expect(nextLoadStatus("at_pickup", north(delivery, 0), pickup, delivery)).toEqual({ status: "at_delivery", events: ["departed_pickup", "arrived_delivery"] });
  });

  it("never changes a load that is not being tracked", () => {
    for (const s of ["invited", "delivered", "cancelled", "declined"] as const) {
      expect(nextLoadStatus(s, north(pickup, 0), pickup, delivery)).toEqual({ status: s, events: [] });
    }
  });

  it("never goes backwards", () => {
    expect(nextLoadStatus("in_transit", north(pickup, 0), pickup, delivery).status).toBe("in_transit");
  });
});

describe("estimateLoadEta", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  it("estimates to delivery while in transit and flags late", () => {
    const e = estimateLoadEta("in_transit", pickup, now, { ...pickup, appointmentAt: null }, { ...delivery, appointmentAt: new Date("2026-11-02T18:00:00Z") })!;
    expect(e.target).toBe("delivery");
    expect(e.distanceM / 1000).toBeGreaterThan(640);
    expect(e.distanceM / 1000).toBeLessThan(670);
    // ~655 km at 80 km/h ≈ 8.2 h → about 20:10, more than two hours late.
    expect(e.lateByMinutes).toBeGreaterThan(120);
    expect(e.late).toBe(true);
  });

  it("estimates to pickup before arrival and is on time within the grace period", () => {
    const from = north(pickup, 10_000);
    const e = estimateLoadEta("tracking", from, now, { ...pickup, appointmentAt: new Date("2026-11-02T12:00:00Z") }, { ...delivery, appointmentAt: null })!;
    expect(e.target).toBe("pickup");
    // 13 km at 80 km/h ≈ 10 minutes: late by ~10, inside the 15-minute grace.
    expect(e.late).toBe(false);
  });

  it("has no estimate while at a stop or after the load ended", () => {
    for (const s of ["invited", "at_pickup", "at_delivery", "delivered"] as const) {
      expect(estimateLoadEta(s, pickup, now, { ...pickup, appointmentAt: null }, { ...delivery, appointmentAt: null })).toBeNull();
    }
  });
});

describe("isLoadPositionStale", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  it("is stale without a position or after 30 minutes", () => {
    expect(isLoadPositionStale(null, now)).toBe(true);
    expect(isLoadPositionStale(new Date("2026-11-02T11:40:00Z"), now)).toBe(false);
    expect(isLoadPositionStale(new Date("2026-11-02T11:29:00Z"), now)).toBe(true);
  });
});
