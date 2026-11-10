import { describe, expect, it } from "vitest";
import { CACHE_MAX_AGE_MS, decodeCache, encodeCache } from "./cacheModel";
import type { FleetDevice } from "./model";

const dev = (id: string): FleetDevice => ({ deviceId: id, model: null, name: id, deviceStatus: "active", vehicle: null, connectivity: "online", lastSeenAt: null, location: null });
const NOW = Date.UTC(2026, 10, 10, 12);

describe("saved fleet", () => {
  it("comes back as it was saved", () => {
    const back = decodeCache(encodeCache([dev("a"), dev("b")], NOW), NOW + 5000);
    expect(back?.devices.map((d) => d.deviceId)).toEqual(["a", "b"]);
    expect(back?.savedAt).toBe(NOW);
  });
  it("is ignored when missing, damaged, empty, too old, or from the future", () => {
    expect(decodeCache(null, NOW)).toBeNull();
    expect(decodeCache("{oops", NOW)).toBeNull();
    expect(decodeCache('{"v":2,"savedAt":1,"devices":[]}', NOW)).toBeNull();
    expect(decodeCache(encodeCache([], NOW), NOW)).toBeNull();
    expect(decodeCache(encodeCache([dev("a")], NOW), NOW + CACHE_MAX_AGE_MS + 1)).toBeNull();
    expect(decodeCache(encodeCache([dev("a")], NOW + 3_600_000), NOW)).toBeNull();
  });
  it("drops entries that are not trackers", () => {
    const raw = JSON.stringify({ v: 1, savedAt: NOW, devices: [dev("a"), null, { name: "x" }] });
    expect(decodeCache(raw, NOW)?.devices).toHaveLength(1);
  });
});
