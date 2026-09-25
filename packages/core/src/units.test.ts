import { describe, expect, it } from "vitest";
import { units } from "./units.js";

describe("units", () => {
  const us = units("imperial");
  const ca = units("metric");
  it("converts for display without touching stored metric values", () => {
    expect(us.fmtSpeed(100)).toBe("62 mph");
    expect(ca.fmtSpeed(100)).toBe("100 km/h");
    expect(us.fmtDist(688.1)).toBe("427.6 mi");
    expect(ca.fmtDist(688.1)).toBe("688.1 km");
    expect(us.fmtDist(null)).toBe("—");
    expect(us.fmtDist(0.05)).toBe("< 0.1 mi");
    expect(ca.fmtDist(0)).toBe("0 km");
    expect(us.fmtSpeed(undefined)).toBe("—");
  });
  it("round-trips user input back to metric", () => {
    expect(us.toKph(65)).toBeCloseTo(104.607, 2);
    expect(us.toKm(5000)).toBeCloseTo(8046.72, 2);
    expect(ca.toKm(5000)).toBe(5000);
  });
  it("large numbers get US digit grouping", () => {
    expect(us.fmtDist(16093.44, 0)).toBe("10,000 mi");
  });
});
