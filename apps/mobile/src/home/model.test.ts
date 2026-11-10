import { describe, expect, it } from "vitest";
import type { FleetDevice } from "../fleet/model";
import { firstName, fleetSummary, greeting, onTheMove } from "./model";

const NOW = new Date().toISOString();
const dev = (id: string, speedKph: number, over: Partial<FleetDevice> = {}): FleetDevice => ({
  deviceId: id, model: null, name: id, deviceStatus: "active", vehicle: null, connectivity: "online", lastSeenAt: NOW,
  location: { latitude: 43, longitude: -79, speedKph, headingDeg: 0, altitudeM: null, ignition: speedKph > 0, motion: speedKph > 0, recordedAt: NOW, receivedAt: NOW },
  ...over
});

describe("home screen", () => {
  it("greets by time of day", () => {
    expect([6, 13, 19, 2].map(greeting)).toEqual(["Good morning", "Good afternoon", "Good evening", "Hello"]);
  });
  it("uses the first name, and nothing for an email or a missing name", () => {
    expect(firstName("Deepak Kumar")).toBe("Deepak");
    expect(firstName("  RIO GPS Demo ")).toBe("RIO");
    expect(firstName("support@riogps.com")).toBe("");
    expect(firstName(null)).toBe("");
  });
  it("summarises the fleet into four groups whose shares add up", () => {
    const s = fleetSummary([dev("a", 90), dev("b", 80), dev("c", 0), dev("d", 0, { connectivity: "offline" })]);
    expect(s.total).toBe(4);
    expect(s.parts.map((p) => p.key)).toEqual(["moving", "idle", "stopped", "offline"]);
    expect(s.parts.find((p) => p.key === "moving")?.count).toBe(2);
    expect(s.parts.find((p) => p.key === "offline")?.count).toBe(1);
    expect(s.parts.reduce((sum, p) => sum + p.count, 0)).toBe(4);
    expect(s.parts.reduce((sum, p) => sum + p.share, 0)).toBeCloseTo(1);
  });
  it("copes with an empty fleet", () => {
    const s = fleetSummary([]);
    expect(s.total).toBe(0);
    expect(s.parts.every((p) => p.share === 0)).toBe(true);
    expect(onTheMove([], 3)).toEqual([]);
  });
  it("lists moving vehicles fastest first, up to the limit", () => {
    const list = onTheMove([dev("slow", 40), dev("parked", 0), dev("fast", 110), dev("mid", 70)], 2);
    expect(list.map((d) => d.deviceId)).toEqual(["fast", "mid"]);
  });
});
