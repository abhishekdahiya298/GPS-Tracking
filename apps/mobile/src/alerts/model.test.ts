import { describe, expect, it } from "vitest";
import { alertDetail, alertMeta, alertTitle, badgeText, markRead, mergeEvents, type AlertEvent } from "./model";

const ev = (over: Partial<AlertEvent> = {}): AlertEvent => ({
  id: 1, type: "speeding", ruleName: "Highway limit", deviceId: "d", vehicleId: "v", vehicleName: "Truck 1",
  occurredAt: "2026-10-09T12:00:00Z", latitude: 43.5, longitude: -79.6, details: null, acknowledgedAt: null, ...over
});
const mph = (kph: number | null) => (kph === null ? "-" : `${Math.round(kph / 1.609344)} mph`);

describe("alert wording", () => {
  it("writes a headline per type, naming the zone when known", () => {
    expect(alertTitle(ev())).toBe("Truck 1 is speeding");
    expect(alertTitle(ev({ type: "device_offline" }))).toBe("Truck 1 went offline");
    expect(alertTitle(ev({ type: "geofence_enter", details: { geofence: "Yard" } }))).toBe("Truck 1 entered Yard");
    expect(alertTitle(ev({ type: "geofence_exit", details: {} }))).toBe("Truck 1 left a zone");
    expect(alertTitle(ev({ type: "ignition_on", vehicleName: null }))).toBe("A vehicle ignition on");
  });
  it("adds speed and limit, or how long a tracker was silent", () => {
    expect(alertDetail(ev({ details: { speedKph: 120.7, limitKph: 104.6 } }), mph)).toBe("75 mph, limit 65 mph");
    expect(alertDetail(ev({ details: { speedKph: 120.7 } }), mph)).toBe("75 mph");
    expect(alertDetail(ev({ details: null }), mph)).toBeNull();
    expect(alertDetail(ev({ type: "device_offline", details: { offlineMinutes: 45 } }), mph)).toBe("No signal for 45 min");
    expect(alertDetail(ev({ type: "device_offline", details: { offlineMinutes: 180 } }), mph)).toBe("No signal for 3 h");
    expect(alertDetail(ev({ type: "geofence_enter", details: { geofence: "Yard" } }), mph)).toBeNull();
  });
  it("still labels a type the app has never seen", () => {
    expect(alertMeta("harsh_braking").label).toBe("Harsh braking");
    expect(alertTitle(ev({ type: "harsh_braking" }))).toBe("Truck 1 harsh braking");
  });
});

describe("list handling", () => {
  it("merges pages without duplicates, newest first, and takes the newer copy of an alert", () => {
    const merged = mergeEvents([ev({ id: 5 }), ev({ id: 3 })], [ev({ id: 3, acknowledgedAt: "x" }), ev({ id: 7 }), ev({ id: 2 })]);
    expect(merged.map((e) => e.id)).toEqual([7, 5, 3, 2]);
    expect(merged[2]!.acknowledgedAt).toBe("x");
  });
  it("marks alerts read in place, or removes them when only unread ones are shown", () => {
    const list = [ev({ id: 3 }), ev({ id: 2, acknowledgedAt: "old" }), ev({ id: 1 })];
    expect(markRead(list, [3], "now", false).map((e) => e.acknowledgedAt)).toEqual(["now", "old", null]);
    expect(markRead(list, "all", "now", false).map((e) => e.acknowledgedAt)).toEqual(["now", "old", "now"]);
    expect(markRead([ev({ id: 3 }), ev({ id: 1 })], [3], "now", true).map((e) => e.id)).toEqual([1]);
    expect(markRead([ev({ id: 3 }), ev({ id: 1 })], "all", "now", true)).toEqual([]);
  });
  it("shows a badge only when something is unread, capped at 99+", () => {
    expect([0, -1, 1, 99, 100].map(badgeText)).toEqual([undefined, undefined, "1", "99", "99+"]);
  });
});
