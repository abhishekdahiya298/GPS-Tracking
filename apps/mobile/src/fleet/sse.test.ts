import { describe, expect, it } from "vitest";
import type { FleetDevice } from "./model";
import { applyLocation, backoffMs, createSseParser, mergeSnapshot, parseJson, type LiveLocationEvent, type SseEvent } from "./sse";

const dev = (id: string, recordedAt: string | null): FleetDevice => ({
  deviceId: id, model: null, name: null, deviceStatus: "active", vehicle: null, connectivity: "offline", lastSeenAt: recordedAt,
  location: recordedAt ? { latitude: 43, longitude: -79, speedKph: 0, headingDeg: null, altitudeM: null, ignition: null, motion: null, recordedAt, receivedAt: recordedAt } : null
});
const loc = (deviceId: string, recordedAt: string, over: Partial<LiveLocationEvent> = {}): LiveLocationEvent => ({
  deviceId, latitude: 44, longitude: -80, speedKph: 90, headingDeg: 180, altitudeM: null, ignition: true, motion: true, recordedAt, receivedAt: recordedAt, ...over
});

describe("stream parser", () => {
  const collect = () => {
    const got: SseEvent[] = [];
    return { got, parser: createSseParser((e) => got.push(e)) };
  };
  it("reads events whole, however the text is cut into pieces", () => {
    const text = 'event: snapshot\ndata: {"devices":[]}\n\n: keep-alive\n\nevent: location\ndata: {"deviceId":"a"}\n\n';
    for (const size of [1, 3, 7, text.length]) {
      const { got, parser } = collect();
      for (let i = 0; i < text.length; i += size) parser.feed(text.slice(i, i + size));
      expect(got).toEqual([{ event: "snapshot", data: '{"devices":[]}' }, { event: "location", data: '{"deviceId":"a"}' }]);
    }
  });
  it("handles Windows line ends, data on several lines, and events with no name", () => {
    const { got, parser } = collect();
    parser.feed("data: one\r\ndata: two\r\n\r\n");
    parser.feed("event: end\r");
    parser.feed('\ndata: {"reason":"x"}\r\n\r\n');
    expect(got).toEqual([{ event: "message", data: "one\ntwo" }, { event: "end", data: '{"reason":"x"}' }]);
  });
  it("does not send half an event", () => {
    const { got, parser } = collect();
    parser.feed("event: location\ndata: {");
    expect(got).toEqual([]);
  });
  it("reads JSON without throwing on rubbish", () => {
    expect(parseJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson("{oops")).toBeNull();
  });
});

describe("live positions", () => {
  it("moves a known tracker and marks it online", () => {
    const fleet = new Map([["a", dev("a", "2026-11-10T10:00:00Z")]]);
    const next = applyLocation(fleet, loc("a", "2026-11-10T10:00:30Z"));
    expect(next?.location?.latitude).toBe(44);
    expect(next?.connectivity).toBe("online");
    expect(next?.lastSeenAt).toBe("2026-11-10T10:00:30Z");
  });
  it("ignores unknown trackers, old or repeated positions, and broken events", () => {
    const fleet = new Map([["a", dev("a", "2026-11-10T10:00:00Z")]]);
    expect(applyLocation(fleet, loc("zzz", "2026-11-10T10:00:30Z"))).toBeNull();
    expect(applyLocation(fleet, loc("a", "2026-11-10T09:59:00Z"))).toBeNull();
    expect(applyLocation(fleet, loc("a", "2026-11-10T10:00:00Z"))).toBeNull();
    expect(applyLocation(fleet, loc("a", "2026-11-10T10:01:00Z", { latitude: NaN }))).toBeNull();
  });
  it("gives a tracker its first position", () => {
    const next = applyLocation(new Map([["a", dev("a", null)]]), loc("a", "2026-11-10T10:00:30Z"));
    expect(next?.location?.recordedAt).toBe("2026-11-10T10:00:30Z");
  });
});

describe("full refresh", () => {
  it("takes the server's list but keeps a live position that is newer", () => {
    const live = applyLocation(new Map([["a", dev("a", "2026-11-10T10:00:00Z")]]), loc("a", "2026-11-10T10:05:00Z"))!;
    const merged = mergeSnapshot(new Map([["a", live], ["gone", dev("gone", null)]]), [dev("a", "2026-11-10T10:03:00Z"), dev("b", "2026-11-10T10:04:00Z")]);
    expect([...merged.keys()]).toEqual(["a", "b"]); // removed trackers disappear
    expect(merged.get("a")?.location?.recordedAt).toBe("2026-11-10T10:05:00Z");
    expect(merged.get("a")?.connectivity).toBe("online");
    expect(merged.get("b")?.location?.recordedAt).toBe("2026-11-10T10:04:00Z");
  });
  it("takes the server's position when it is the newer one", () => {
    const merged = mergeSnapshot(new Map([["a", dev("a", "2026-11-10T10:00:00Z")]]), [dev("a", "2026-11-10T10:03:00Z")]);
    expect(merged.get("a")?.location?.recordedAt).toBe("2026-11-10T10:03:00Z");
  });
});

it("waits longer between reconnects, up to 30 s", () => {
  expect([1, 2, 3, 4, 5, 9].map(backoffMs)).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
});
