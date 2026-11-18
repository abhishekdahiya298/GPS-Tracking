import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_FIX_AGE_SECONDS, fixAgeSeconds, isFixStale } from "./freshness.js";

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
