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
    // A driving fix goes stale after about an hour.
    expect(fleetState({ connectivity: "online", location: { ...backlog, recordedAt: "2026-11-18T15:50:00Z" } }, { nowMs })).toBe("stopped");
  });

  it("parked trackers report every 4 h: not flagged before that, and a driving one gets 15 min", () => {
    const nowMs = Date.parse("2026-11-27T12:00:00Z");
    const parked = { speedKph: 0, ignition: false, recordedAt: "2026-11-27T08:30:00Z" };
    // Parked, last report 3 h 30 min ago: still Stopped (not offline, not "No GPS").
    expect(fleetState({ connectivity: "online", lastSeenAt: "2026-11-27T08:30:00Z", location: parked }, { nowMs })).toBe("stopped");
    // Parked, silent 5 h: past the 4 h 30 min allowance.
    expect(fleetState({ connectivity: "online", lastSeenAt: "2026-11-27T07:00:00Z", location: parked }, { nowMs })).toBe("offline");
    // Driving at the last report and silent 20 min: dead zone ("No signal").
    const driving = { speedKph: 90, ignition: true, recordedAt: "2026-11-27T11:40:00Z" };
    expect(fleetState({ connectivity: "online", lastSeenAt: "2026-11-27T11:40:00Z", location: driving }, { nowMs })).toBe("offline");
    expect(fleetState({ connectivity: "online", lastSeenAt: "2026-11-27T11:50:00Z", location: { ...driving, recordedAt: "2026-11-27T11:50:00Z" } }, { nowMs })).toBe("moving");
    // A trailer silent past its allowance is Parked (unhooked).
    expect(fleetState({ connectivity: "online", lastSeenAt: "2026-11-27T07:00:00Z", location: parked, vehicle: { type: "trailer" } }, { nowMs })).toBe("parked");
  });
});
