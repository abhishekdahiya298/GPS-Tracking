import { describe, expect, it } from "vitest";
import { ago, currentLoad, inviteToken, mergeQueue, permissionFrom, toPoints, type DriverLoad } from "./model";

const loc = (t: number, lat = 43.7, speed: number | null = 20) => ({ timestamp: t, coords: { latitude: lat, longitude: -79.7, speed, heading: 90, altitude: 120, accuracy: 8 } });

describe("driver model", () => {
  it("reads the phone's permission", () => {
    expect(permissionFrom(true, true)).toBe("always");
    expect(permissionFrom(true, false)).toBe("while_using");
    expect(permissionFrom(false, false)).toBe("off");
  });

  it("turns phone fixes into report points", () => {
    const [p] = toPoints([loc(Date.UTC(2026, 10, 25, 12))]);
    expect(p).toMatchObject({ latitude: 43.7, speedKph: 72, headingDeg: 90, accuracyM: 8, recordedAt: "2026-11-25T12:00:00.000Z" });
    expect(toPoints([loc(1, 43.7, -1)])[0]!.speedKph).toBeNull();
    expect(toPoints([loc(1, 123)])).toEqual([]);
  });

  it("queues points oldest first without repeats, keeping the newest", () => {
    const a = toPoints([loc(1000), loc(3000)]);
    const b = toPoints([loc(2000), loc(3000)]);
    const q = mergeQueue(a, b);
    expect(q.map((p) => Date.parse(p.recordedAt))).toEqual([1000, 2000, 3000]);
    expect(mergeQueue(q, [], 2).map((p) => Date.parse(p.recordedAt))).toEqual([2000, 3000]);
  });

  it("finds the load being worked on", () => {
    const l = (id: string, status: string) => ({ id, status }) as DriverLoad;
    expect(currentLoad([l("a", "tracking"), l("b", "in_transit")])?.id).toBe("b");
    expect(currentLoad([l("a", "delivered")])).toBeNull();
  });

  it("reads an invite link or token", () => {
    const t = "abcdefghijklmnopqrstuvwxyz012345";
    expect(inviteToken(`riogps://driver?t=${t}`)).toBe(t);
    expect(inviteToken(`https://app.riogps.com/driver-app?t=${t}`)).toBe(t);
    expect(inviteToken(t)).toBe(t);
    expect(inviteToken("hello")).toBeNull();
  });

  it("says how long ago", () => {
    const now = Date.parse("2026-11-25T12:00:00Z");
    expect(ago("2026-11-25T11:59:40Z", now)).toBe("just now");
    expect(ago("2026-11-25T11:45:00Z", now)).toBe("15 min ago");
    expect(ago(null, now)).toBe("not yet");
  });
});
