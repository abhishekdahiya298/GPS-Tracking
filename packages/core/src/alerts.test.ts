import { describe, expect, it } from "vitest";
import { evaluateOffline, evaluatePosition } from "./alerts.js";

describe("alert evaluation", () => {
  it("geofence: first observation initializes silently, then fires on transitions only", () => {
    let s = evaluatePosition("geofence_enter", {}, {}, { speedKph: 0, ignition: null, inside: true });
    expect(s.fire).toBe(false);
    s = evaluatePosition("geofence_enter", {}, s.next, { speedKph: 0, ignition: null, inside: true });
    expect(s.fire).toBe(false);
    s = evaluatePosition("geofence_enter", {}, s.next, { speedKph: 0, ignition: null, inside: false });
    expect(s.fire).toBe(false);
    s = evaluatePosition("geofence_enter", {}, s.next, { speedKph: 0, ignition: null, inside: true });
    expect(s.fire).toBe(true);
    const exit = evaluatePosition("geofence_exit", {}, s.next, { speedKph: 0, ignition: null, inside: false });
    expect(exit.fire).toBe(true);
  });

  it("speeding fires once per episode with hysteresis", () => {
    const run = (speeds: number[]) => {
      let st = {};
      const fired: number[] = [];
      for (const v of speeds) {
        const e = evaluatePosition("speeding", { speedKph: 100 }, st, { speedKph: v, ignition: true });
        if (e.fire) fired.push(v);
        st = e.next;
      }
      return fired;
    };
    expect(run([90, 101, 120, 99, 97, 101])).toEqual([101]); // 99/97 don't re-arm (need < 95)
    expect(run([101, 94, 105])).toEqual([101, 105]);
  });

  it("ignition on/off transitions; unknown ignition is ignored", () => {
    let st = evaluatePosition("ignition_on", {}, {}, { speedKph: 0, ignition: false }).next;
    expect(evaluatePosition("ignition_on", {}, st, { speedKph: 0, ignition: null }).fire).toBe(false);
    const on = evaluatePosition("ignition_on", {}, st, { speedKph: 0, ignition: true });
    expect(on.fire).toBe(true);
    st = on.next;
    expect(evaluatePosition("ignition_off", {}, st, { speedKph: 0, ignition: false }).fire).toBe(true);
  });

  it("offline fires once and re-arms when seen again", () => {
    const now = new Date("2026-09-25T12:00:00Z");
    const old = new Date("2026-09-25T10:00:00Z");
    const a = evaluateOffline({}, old, now, 90);
    expect(a.fire).toBe(true);
    expect(evaluateOffline(a.next, old, now, 90).fire).toBe(false);
    const back = evaluatePosition("device_offline", {}, a.next, { speedKph: 0, ignition: null });
    expect(back.next.offline).toBe(false);
    expect(evaluateOffline({}, new Date("2026-09-25T11:59:00Z"), now, 90).fire).toBe(false);
  });
});
