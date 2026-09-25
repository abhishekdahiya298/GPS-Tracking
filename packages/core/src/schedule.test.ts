import { describe, expect, it } from "vitest";
import { duePeriod, latestCompletedPeriod, zonedTimeToUtc } from "./schedule.js";

describe("zonedTimeToUtc", () => {
  it("handles fixed and DST zones", () => {
    expect(zonedTimeToUtc(2026, 9, 25, 0, "Asia/Kolkata").toISOString()).toBe("2026-09-24T18:30:00.000Z");
    expect(zonedTimeToUtc(2026, 7, 1, 0, "America/Los_Angeles").toISOString()).toBe("2026-07-01T07:00:00.000Z");
    expect(zonedTimeToUtc(2026, 12, 1, 0, "America/Los_Angeles").toISOString()).toBe("2026-12-01T08:00:00.000Z");
    expect(zonedTimeToUtc(2026, 1, 1, 0, "UTC").toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("duePeriod daily", () => {
  const spec = { frequency: "daily" as const, timeZone: "Asia/Kolkata", sendHour: 7, weekday: 1 };
  it("not due before the send hour", () => {
    expect(duePeriod(spec, new Date("2026-09-25T01:00:00Z"))).toBeNull(); // 06:30 IST
  });
  it("due after the send hour, covering yesterday local", () => {
    const p = duePeriod(spec, new Date("2026-09-25T02:00:00Z"))!; // 07:30 IST
    expect(p.key).toBe("daily:2026-09-24");
    expect(p.from.toISOString()).toBe("2026-09-23T18:30:00.000Z");
    expect(p.to.toISOString()).toBe("2026-09-24T18:30:00.000Z");
  });
  it("same key for the rest of the day (idempotent)", () => {
    expect(duePeriod(spec, new Date("2026-09-25T18:00:00Z"))!.key).toBe("daily:2026-09-24"); // 23:30 IST
  });
  it("a DST-change day in Los Angeles is 25 hours long", () => {
    const p = duePeriod({ ...spec, timeZone: "America/Los_Angeles", sendHour: 0 }, new Date("2026-11-02T12:00:00Z"))!;
    expect(p.key).toBe("daily:2026-11-01");
    expect(p.to.getTime() - p.from.getTime()).toBe(25 * 3600_000);
  });
});

describe("duePeriod weekly", () => {
  const spec = { frequency: "weekly" as const, timeZone: "UTC", sendHour: 8, weekday: 1 };
  it("covers the previous Mon–Sun week once Monday 08:00 has passed", () => {
    const p = duePeriod(spec, new Date("2026-09-21T09:00:00Z"))!; // Monday
    expect(p.key).toBe("weekly:2026-09-14");
    expect(p.label).toBe("2026-09-14 – 2026-09-20");
    expect(p.from.toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-09-21T00:00:00.000Z");
    expect(duePeriod(spec, new Date("2026-09-26T09:00:00Z"))!.key).toBe("weekly:2026-09-14"); // Saturday, same week
  });
  it("not due on Monday before 08:00", () => {
    expect(duePeriod(spec, new Date("2026-09-21T07:59:00Z"))).toBeNull();
  });
  it("send on Friday: not due Monday–Thursday", () => {
    expect(duePeriod({ ...spec, weekday: 5 }, new Date("2026-09-24T12:00:00Z"))).toBeNull();
    expect(duePeriod({ ...spec, weekday: 5 }, new Date("2026-09-25T12:00:00Z"))!.key).toBe("weekly:2026-09-14");
  });
  it("latestCompletedPeriod ignores the send time", () => {
    expect(latestCompletedPeriod(spec, new Date("2026-09-21T01:00:00Z")).key).toBe("weekly:2026-09-14");
    expect(latestCompletedPeriod({ ...spec, frequency: "daily" }, new Date("2026-09-21T01:00:00Z")).key).toBe("daily:2026-09-20");
  });
});
