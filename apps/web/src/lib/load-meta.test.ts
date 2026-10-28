import { describe, expect, it } from "vitest";
import { loadMotion, needsAttention, shortPlace } from "./load-meta";

const now = Date.parse("2026-11-02T12:00:00Z");
const base = { status: "in_transit", sharingStopped: false, stale: false, eta: null, lastPosition: { speedKph: 90, at: "2026-11-02T11:58:00Z" } };

describe("loadMotion", () => {
  it("moving needs speed and a fresh position", () => {
    expect(loadMotion(base, now)).toBe("moving");
    expect(loadMotion({ ...base, lastPosition: { speedKph: 3, at: "2026-11-02T11:58:00Z" } }, now)).toBe("stopped");
    expect(loadMotion({ ...base, lastPosition: { speedKph: null, at: "2026-11-02T11:58:00Z" } }, now)).toBe("stopped");
    // 90 km/h but 15 minutes old: not trusted as moving.
    expect(loadMotion({ ...base, lastPosition: { speedKph: 90, at: "2026-11-02T11:45:00Z" } }, now)).toBe("stopped");
  });
  it("waiting, paused and no signal win over speed", () => {
    expect(loadMotion({ ...base, status: "invited" }, now)).toBe("waiting");
    expect(loadMotion({ ...base, sharingStopped: true }, now)).toBe("paused");
    expect(loadMotion({ ...base, stale: true }, now)).toBe("no_signal");
    expect(loadMotion({ ...base, lastPosition: null }, now)).toBe("no_signal");
  });
  it("needs attention when late, silent or paused", () => {
    expect(needsAttention(base)).toBe(false);
    expect(needsAttention({ ...base, eta: { late: true } })).toBe(true);
    expect(needsAttention({ ...base, stale: true })).toBe(true);
    expect(needsAttention({ ...base, sharingStopped: true })).toBe(true);
  });
  it("short places still work", () => {
    expect(shortPlace(null, "Montréal, QC, Canada")).toBe("Montréal, QC");
  });
});
