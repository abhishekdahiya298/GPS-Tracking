import { describe, expect, it } from "vitest";
import { compassPoint, countByFilter, displayName, fleetState, selectDevices, statusLine, timeAgo, type FleetDevice } from "./model";

const NOW = Date.parse("2026-10-09T12:00:00Z");
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();
function device(over: Partial<FleetDevice> & { speed?: number | null; ignition?: boolean | null } = {}): FleetDevice {
  const { speed = 0, ignition = null, ...rest } = over;
  return {
    deviceId: "d1",
    model: "FTM880",
    name: null,
    deviceStatus: "active",
    vehicle: { id: "v1", name: "Truck 1", licensePlate: "ABC 123", type: "truck" },
    connectivity: "online",
    lastSeenAt: ago(30),
    location: { latitude: 43.5, longitude: -79.6, speedKph: speed, headingDeg: 90, altitudeM: null, ignition, motion: null, recordedAt: ago(30), receivedAt: ago(29) },
    ...rest
  };
}
const fmt = (kph: number | null) => (kph === null ? "-" : `${Math.round(kph / 1.609344)} mph`);

describe("fleetState (must match the web app)", () => {
  it("covers the four states and trackers that never reported", () => {
    expect(fleetState(device({ speed: 60 }))).toBe("moving");
    expect(fleetState(device({ speed: 5 }))).toBe("moving");
    expect(fleetState(device({ speed: 4.9, ignition: true }))).toBe("idle");
    expect(fleetState(device({ speed: 0, ignition: false }))).toBe("stopped");
    expect(fleetState(device({ speed: 0, ignition: null }))).toBe("stopped");
    expect(fleetState(device({ speed: 80, connectivity: "offline" }))).toBe("offline");
    expect(fleetState(device({ connectivity: "never_seen", location: null }))).toBe("never_seen");
    expect(fleetState(device({ connectivity: "offline", location: null }))).toBe("offline");
    expect(fleetState(device({ connectivity: "online", location: null }))).toBe("never_seen");
  });
});

describe("list selection", () => {
  const fleet = [
    device({ deviceId: "a", vehicle: { id: "1", name: "Truck 10", licensePlate: "ZZZ 999", type: "truck" }, speed: 0, ignition: false }),
    device({ deviceId: "b", vehicle: { id: "2", name: "Truck 2", licensePlate: "ABC 123", type: "truck" }, speed: 70 }),
    device({ deviceId: "c", vehicle: null, name: "Spare tracker", connectivity: "never_seen", location: null, lastSeenAt: null }),
    device({ deviceId: "d", vehicle: { id: "4", name: "Trailer 7", licensePlate: null, type: "trailer" }, connectivity: "offline" }),
    device({ deviceId: "e", vehicle: { id: "5", name: "Truck 1", licensePlate: null, type: "truck" }, speed: 0, ignition: true })
  ];
  it("counts each filter, with never-reported trackers under Offline", () => {
    expect(countByFilter(fleet)).toEqual({ all: 5, moving: 1, idle: 1, stopped: 1, offline: 2 });
  });
  it("puts active vehicles first, then sorts names the way people read numbers", () => {
    expect(selectDevices(fleet, "all", "").map((d) => d.deviceId)).toEqual(["b", "e", "a", "d", "c"]);
    const trucks = [device({ deviceId: "x", vehicle: { id: "x", name: "Truck 10", licensePlate: null, type: "truck" } }), device({ deviceId: "y", vehicle: { id: "y", name: "Truck 2", licensePlate: null, type: "truck" } })];
    expect(selectDevices(trucks, "all", "").map((d) => d.deviceId)).toEqual(["y", "x"]);
  });
  it("filters by status and searches name, plate and tracker name without caring about case", () => {
    expect(selectDevices(fleet, "offline", "").map((d) => d.deviceId)).toEqual(["d", "c"]);
    expect(selectDevices(fleet, "all", "abc").map((d) => d.deviceId)).toEqual(["b"]);
    expect(selectDevices(fleet, "all", "  SPARE ").map((d) => d.deviceId)).toEqual(["c"]);
    expect(selectDevices(fleet, "moving", "truck 10")).toEqual([]);
  });
  it("does not change the list it was given", () => {
    const before = fleet.map((d) => d.deviceId);
    selectDevices(fleet, "all", "");
    expect(fleet.map((d) => d.deviceId)).toEqual(before);
  });
  it("names a tracker without a vehicle by its own name, then its model", () => {
    expect(displayName(device({ vehicle: null, name: "Spare" }))).toBe("Spare");
    expect(displayName(device({ vehicle: null, name: null }))).toBe("FTM880");
    expect(displayName(device({ vehicle: null, name: null, model: null }))).toBe("Unnamed tracker");
  });
});

describe("wording", () => {
  it("says how long ago in plain words", () => {
    expect(timeAgo(ago(5), NOW)).toBe("just now");
    expect(timeAgo(ago(-120), NOW)).toBe("just now");
    expect(timeAgo(ago(60), NOW)).toBe("1 min ago");
    expect(timeAgo(ago(59 * 60), NOW)).toBe("59 min ago");
    expect(timeAgo(ago(3 * 3600), NOW)).toBe("3 h ago");
    expect(timeAgo(ago(26 * 3600), NOW)).toBe("1 day ago");
    expect(timeAgo(ago(5 * 86400), NOW)).toBe("5 days ago");
    expect(timeAgo(null, NOW)).toBe("never");
    expect(timeAgo("not a date", NOW)).toBe("unknown");
  });
  it("turns a heading into a compass point", () => {
    expect([0, 44, 90, 180, 270, 337, 360, -45].map(compassPoint)).toEqual(["N", "NE", "E", "S", "W", "NW", "N", "NW"]);
    expect(compassPoint(null)).toBeNull();
  });
  it("writes one status line per state", () => {
    expect(statusLine(device({ speed: 96.56 }), fmt, NOW)).toBe("60 mph E · just now");
    expect(statusLine(device({ speed: 0, ignition: true, lastSeenAt: ago(300), location: { ...device().location!, speedKph: 0, ignition: true, recordedAt: ago(300) } }), fmt, NOW)).toBe("Engine on · 5 min ago");
    expect(statusLine(device({ speed: 0, ignition: false }), fmt, NOW)).toBe("Parked · just now");
    expect(statusLine(device({ connectivity: "offline", lastSeenAt: ago(7200) }), fmt, NOW)).toBe("Last seen 2 h ago");
    expect(statusLine(device({ connectivity: "never_seen", location: null, lastSeenAt: null }), fmt, NOW)).toBe("Waiting for the first report");
  });
});
