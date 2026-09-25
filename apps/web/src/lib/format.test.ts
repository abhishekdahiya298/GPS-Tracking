import { describe, expect, it } from "vitest";
import { fleetState } from "./fleet-status";
import { durationMin, relativeTime } from "./format";

describe("format", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  it("relative time", () => {
    expect(relativeTime(null)).toBe("never");
    expect(relativeTime("2026-09-25T11:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-09-25T11:55:00Z", now)).toBe("5 min ago");
    expect(relativeTime("2026-09-25T07:00:00Z", now)).toBe("5 h ago");
    expect(relativeTime("2026-09-22T12:00:00Z", now)).toBe("3 d ago");
  });
  it("durations", () => {
    expect(durationMin(9)).toBe("9 min");
    expect(durationMin(125)).toBe("2h 05m");
  });
  it("fleet state", () => {
    expect(fleetState({ connectivity: "online", location: { speedKph: 40, ignition: true } })).toBe("moving");
    expect(fleetState({ connectivity: "online", location: { speedKph: 0, ignition: false } })).toBe("idle");
    expect(fleetState({ connectivity: "offline", location: { speedKph: 50, ignition: true } })).toBe("offline");
    expect(fleetState({ connectivity: "never_seen", location: null })).toBe("never_seen");
  });
});
