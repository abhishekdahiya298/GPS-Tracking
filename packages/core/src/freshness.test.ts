import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_FIX_AGE_SECONDS, DEFAULT_OFFLINE_SECONDS, externalPowerVolts, fixAgeSeconds, isFixStale, isSilent, maxFixAgeFor } from "./freshness.js";

describe("fix freshness", () => {
  const now = Date.parse("2026-11-18T17:00:00Z");

  it("measures fix age in seconds, never negative", () => {
    expect(fixAgeSeconds("2026-11-18T16:59:00Z", now)).toBe(60);
    expect(fixAgeSeconds(new Date("2026-11-18T16:59:30Z"), now)).toBe(30);
    expect(fixAgeSeconds("2026-11-18T17:00:05Z", now)).toBe(0); // tracker clock a little ahead
    expect(fixAgeSeconds("not a date", now)).toBe(Number.POSITIVE_INFINITY);
  });

  it("a backlog record from two days ago is stale; an hourly parked record is not", () => {
    expect(isFixStale("2026-11-16T17:54:00Z", now)).toBe(true);
    expect(isFixStale("2026-11-18T16:05:00Z", now)).toBe(false); // 55 min, low-data idle period
    expect(isFixStale(new Date(now - (DEFAULT_MAX_FIX_AGE_SECONDS + 1) * 1000), now)).toBe(true);
    expect(isFixStale(new Date(now - DEFAULT_MAX_FIX_AGE_SECONDS * 1000), now)).toBe(false);
  });

  it("honours a custom limit", () => {
    expect(isFixStale("2026-11-18T16:50:00Z", now, 300)).toBe(true);
    expect(isFixStale("2026-11-18T16:58:00Z", now, 300)).toBe(false);
  });
});

describe("state-aware silence", () => {
  const t = Date.parse("2026-11-27T12:00:00Z");
  it("a parked tracker is allowed 4 h 30 min", () => {
    expect(isSilent("2026-11-27T08:00:00Z", { speedKph: 0 }, t)).toBe(false);
    expect(isSilent("2026-11-27T07:29:00Z", { speedKph: 0 }, t)).toBe(true);
  });
  it("a driving tracker is flagged after 15 min", () => {
    expect(isSilent("2026-11-27T11:50:00Z", { speedKph: 80 }, t)).toBe(false);
    expect(isSilent("2026-11-27T11:44:00Z", { speedKph: 80 }, t)).toBe(true);
  });
  it("never-seen is not silent", () => expect(isSilent(null, null, t)).toBe(false));
  it("a parked fix stays current until the next report is due", () => {
    expect(maxFixAgeFor({ speedKph: 0 })).toBe(DEFAULT_OFFLINE_SECONDS);
    expect(maxFixAgeFor({ speedKph: 60 })).toBe(3_900);
  });
});

describe("externalPowerVolts", () => {
  it("reads power (V), io800 and io66 (mV)", () => {
    expect(externalPowerVolts({ power: 13.8 })).toBe(13.8);
    expect(externalPowerVolts({ power: 13800 })).toBe(13.8);
    expect(externalPowerVolts({ io800: 12650 })).toBe(12.65);
    expect(externalPowerVolts({ io66: 156 })).toBe(0.156);
    expect(externalPowerVolts({})).toBeNull();
    expect(externalPowerVolts(null)).toBeNull();
  });
});
