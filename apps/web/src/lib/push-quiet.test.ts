import { describe, expect, it } from "vitest";
import { inQuietHours, isTimeZone, minutesInZone } from "./push-quiet";

const at = (iso: string) => new Date(iso);

describe("quiet hours", () => {
  it("reads the time of day in the phone's zone", () => {
    expect(minutesInZone(at("2026-11-10T17:00:00Z"), "Asia/Kolkata")).toBe(22 * 60 + 30);
    expect(minutesInZone(at("2026-11-10T17:00:00Z"), "America/Toronto")).toBe(12 * 60);
    expect(minutesInZone(at("2026-11-10T05:00:00Z"), "America/Toronto")).toBe(0); // midnight is 0, not 24
    expect(minutesInZone(at("2026-11-10T17:00:00Z"), "Mars/Olympus")).toBeNull();
    expect(isTimeZone("America/Toronto")).toBe(true);
    expect(isTimeZone("nope")).toBe(false);
  });
  it("is quiet at night across midnight, in the phone's zone only", () => {
    // 22:00 to 06:00
    expect(inQuietHours(at("2026-11-10T17:00:00Z"), 1320, 360, "Asia/Kolkata")).toBe(true); // 22:30 in India
    expect(inQuietHours(at("2026-11-10T17:00:00Z"), 1320, 360, "America/Toronto")).toBe(false); // noon in Toronto
    expect(inQuietHours(at("2026-11-10T08:00:00Z"), 1320, 360, "America/Toronto")).toBe(true); // 03:00
    expect(inQuietHours(at("2026-11-10T11:00:00Z"), 1320, 360, "America/Toronto")).toBe(false); // 06:00 sharp: over
  });
  it("handles a quiet time inside one day", () => {
    expect(inQuietHours(at("2026-11-10T18:00:00Z"), 12 * 60, 14 * 60, "America/Toronto")).toBe(true); // 13:00
    expect(inQuietHours(at("2026-11-10T20:00:00Z"), 12 * 60, 14 * 60, "America/Toronto")).toBe(false); // 15:00
  });
  it("is never quiet when anything is missing, equal or unusable", () => {
    const now = at("2026-11-10T08:00:00Z");
    expect(inQuietHours(now, null, 360, "America/Toronto")).toBe(false);
    expect(inQuietHours(now, 1320, null, "America/Toronto")).toBe(false);
    expect(inQuietHours(now, 1320, 360, null)).toBe(false);
    expect(inQuietHours(now, 600, 600, "America/Toronto")).toBe(false);
    expect(inQuietHours(now, 1320, 360, "Mars/Olympus")).toBe(false);
  });
});
