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
    expect(fleetState({ connectivity: "online", location: { speedKph: 0, ignition: false } })).toBe("stopped");
    expect(fleetState({ connectivity: "online", location: { speedKph: 0, ignition: null } })).toBe("stopped");
    expect(fleetState({ connectivity: "online", location: { speedKph: 0, ignition: true } })).toBe("idle");
    expect(fleetState({ connectivity: "offline", location: { speedKph: 50, ignition: true } })).toBe("offline");
    expect(fleetState({ connectivity: "never_seen", location: null })).toBe("never_seen");
    expect(fleetState({ connectivity: "offline", location: { speedKph: 0, ignition: false }, vehicle: { type: "trailer" } })).toBe("parked");
    expect(fleetState({ connectivity: "offline", location: { speedKph: 0, ignition: false }, vehicle: { type: "truck" } })).toBe("offline");
    expect(fleetState({ connectivity: "never_seen", location: null, vehicle: { type: "trailer" } })).toBe("never_seen");
    // Online, but uploading a two-day-old backlog record at 79 km/h: not "Moving" now.
    const nowMs = Date.parse("2026-11-18T17:00:00Z");
    const backlog = { speedKph: 79, ignition: true, recordedAt: "2026-11-16T17:54:00Z" };
    expect(fleetState({ connectivity: "online", location: backlog }, { nowMs })).toBe("stopped");
    expect(fleetState({ connectivity: "online", location: { ...backlog, recordedAt: "2026-11-18T16:59:00Z" } }, { nowMs })).toBe("moving");
    expect(fleetState({ connectivity: "online", location: { ...backlog, recordedAt: "2026-11-18T16:50:00Z" } }, { nowMs, maxFixAgeSeconds: 300 })).toBe("stopped");
  });
});
