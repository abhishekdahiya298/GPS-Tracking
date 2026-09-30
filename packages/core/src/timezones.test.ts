import { describe, expect, it } from "vitest";
import {
  NORTH_AMERICA_ZONES,
  allTimeZones,
  canonicalTimeZone,
  dateFormatter,
  effectiveTimePrefs,
  isValidTimeZone,
  addDays,
  nextDayKey,
  startOfLocalDay,
  toWallTime,
  wallTimeToUtc,
  zoneAbbr,
  zoneOffset,
  zoneOptionLabel
} from "./timezones";

const WINTER = "2026-01-15T17:00:00Z";
const SUMMER = "2026-07-15T17:00:00Z";

describe("zone catalog", () => {
  it("every curated zone is valid and canonical", () => {
    for (const z of NORTH_AMERICA_ZONES) expect(canonicalTimeZone(z.id)).toBe(z.id);
    expect(new Set(NORTH_AMERICA_ZONES.map((z) => z.id)).size).toBe(NORTH_AMERICA_ZONES.length);
  });
  it("covers every Canadian and US zone people pick", () => {
    const ids = NORTH_AMERICA_ZONES.map((z) => z.id);
    for (const id of ["America/St_Johns", "America/Halifax", "America/Toronto", "America/Winnipeg", "America/Regina", "America/Edmonton", "America/Vancouver", "America/Whitehorse"]) expect(ids).toContain(id);
    for (const id of ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"]) expect(ids).toContain(id);
  });
  it("no-DST flags match reality (same offset in January and July)", () => {
    for (const z of NORTH_AMERICA_ZONES) expect(zoneOffset(z.id, WINTER) === zoneOffset(z.id, SUMMER)).toBe(Boolean(z.noDst));
  });
  it("allTimeZones includes the full IANA list", () => {
    const all = allTimeZones();
    expect(all.length).toBeGreaterThan(300);
    expect(all).toContain("America/Toronto");
    expect(all).toContain("UTC");
  });
});

describe("validation", () => {
  it("canonicalizes aliases and case, rejects junk", () => {
    expect(canonicalTimeZone("america/toronto")).toBe("America/Toronto");
    expect(canonicalTimeZone("US/Eastern")).toBe("America/New_York");
    expect(canonicalTimeZone("Mars/Olympus")).toBeNull();
    expect(canonicalTimeZone("")).toBeNull();
    expect(canonicalTimeZone("America/Toronto; drop table")).toBeNull();
    expect(canonicalTimeZone(42)).toBeNull();
    expect(isValidTimeZone("America/Regina")).toBe(true);
  });
});

describe("abbreviations and offsets (DST aware)", () => {
  it.each([
    ["America/Toronto", "EST", "EDT", "UTC−5", "UTC−4"],
    ["America/St_Johns", "NST", "NDT", "UTC−3:30", "UTC−2:30"],
    ["America/Halifax", "AST", "ADT", "UTC−4", "UTC−3"],
    ["America/Regina", "CST", "CST", "UTC−6", "UTC−6"],
    ["America/Whitehorse", "MST", "MST", "UTC−7", "UTC−7"],
    ["America/Phoenix", "MST", "MST", "UTC−7", "UTC−7"],
    ["America/Los_Angeles", "PST", "PDT", "UTC−8", "UTC−7"],
    ["America/Anchorage", "AKST", "AKDT", "UTC−9", "UTC−8"],
    ["Pacific/Honolulu", "HST", "HST", "UTC−10", "UTC−10"],
    ["UTC", "UTC", "UTC", "UTC", "UTC"]
  ])("%s", (tz, w, s, ow, os) => {
    expect(zoneAbbr(tz, WINTER)).toBe(w);
    expect(zoneAbbr(tz, SUMMER)).toBe(s);
    expect(zoneOffset(tz, WINTER)).toBe(ow);
    expect(zoneOffset(tz, SUMMER)).toBe(os);
  });
  it("labels", () => {
    expect(zoneOptionLabel("America/Toronto", SUMMER)).toBe("Eastern: Toronto, Ottawa, Montréal (EDT, UTC−4)");
    expect(zoneOptionLabel("UTC", SUMMER)).toBe("UTC (Coordinated Universal Time) (UTC)");
    expect(zoneOptionLabel("Europe/Berlin", SUMMER)).toBe("Europe/Berlin (UTC+2)");
    // outside the curated list: numeric offsets only (runtimes disagree on names like "IST")
    expect(zoneAbbr("Asia/Kolkata", SUMMER)).toBe("UTC+5:30");
    expect(zoneAbbr("Europe/London", SUMMER)).toBe("UTC+1");
  });
});

describe("dateFormatter", () => {
  const t = "2026-09-25T19:52:07Z"; // 3:52:07 PM in Toronto (EDT)
  it("12-hour and 24-hour clocks", () => {
    const f12 = dateFormatter("America/Toronto", "12h");
    const f24 = dateFormatter("America/Toronto", "24h");
    expect(f12.dateTime(t)).toBe("Sep 25, 3:52 PM");
    expect(f24.dateTime(t)).toBe("Sep 25, 15:52");
    expect(f12.time(t)).toBe("3:52 PM");
    expect(f24.timeSec(t)).toBe("15:52:07");
    expect(f12.full(t)).toBe("Sep 25, 2026, 3:52:07 PM EDT");
    expect(f24.dateTime("2026-09-25T04:05:00Z")).toBe("Sep 25, 00:05"); // midnight hour is 00, not 24
    expect(f12.iso(t)).toBe("2026-09-25 15:52");
    expect(f24.iso("2026-09-25T04:05:00Z")).toBe("2026-09-25 00:05");
  });
  it("uses only plain spaces (identical server/browser output)", () => {
    expect(dateFormatter("America/Toronto", "12h").dateTime(t)).not.toMatch(/[\u202f\u00a0]/);
  });
  it("local day depends on the zone", () => {
    const late = "2026-09-26T03:30:00Z"; // Sep 25 11:30 PM in Toronto, Sep 25 8:30 PM in Vancouver, Sep 26 in UTC
    expect(dateFormatter("America/Toronto").dayKey(late)).toBe("2026-09-25");
    expect(dateFormatter("America/Vancouver").dayKey(late)).toBe("2026-09-25");
    expect(dateFormatter("UTC").dayKey(late)).toBe("2026-09-26");
    expect(dateFormatter("UTC").day("2026-09-25")).toBe("Fri, Sep 25");
  });
  it("is cached per zone + clock; invalid zones fall back to UTC", () => {
    expect(dateFormatter("America/Toronto", "12h")).toBe(dateFormatter("America/Toronto", "12h"));
    expect(dateFormatter("Nope/Nope").timeZone).toBe("UTC");
  });
});

describe("local day boundaries", () => {
  it("midnight in Toronto, including DST change days", () => {
    expect(startOfLocalDay("2026-07-01", "America/Toronto").toISOString()).toBe("2026-07-01T04:00:00.000Z");
    expect(startOfLocalDay("2026-01-01", "America/Toronto").toISOString()).toBe("2026-01-01T05:00:00.000Z");
    expect(startOfLocalDay("2026-03-08", "America/Toronto").toISOString()).toBe("2026-03-08T05:00:00.000Z"); // spring forward at 2 AM
    expect(startOfLocalDay("2026-11-01", "America/Toronto").toISOString()).toBe("2026-11-01T04:00:00.000Z"); // fall back at 2 AM
    expect(startOfLocalDay("2026-07-01", "America/St_Johns").toISOString()).toBe("2026-07-01T02:30:00.000Z");
  });
  it("a DST day is 23 or 25 hours long", () => {
    const len = (d: string) => (startOfLocalDay(nextDayKey(d), "America/Toronto").getTime() - startOfLocalDay(d, "America/Toronto").getTime()) / 3600_000;
    expect(len("2026-03-08")).toBe(23);
    expect(len("2026-11-01")).toBe(25);
    expect(len("2026-07-01")).toBe(24);
    expect(nextDayKey("2026-12-31")).toBe("2027-01-01");
  });
});

describe("effectiveTimePrefs", () => {
  const org = { timeZone: "America/Toronto", timeFormat: "12h" as const };
  it("user choice wins, null falls back to the organization", () => {
    expect(effectiveTimePrefs(org, { timeZone: null, timeFormat: null })).toEqual({ timeZone: "America/Toronto", timeFormat: "12h" });
    expect(effectiveTimePrefs(org, { timeZone: "America/Vancouver", timeFormat: "24h" })).toEqual({ timeZone: "America/Vancouver", timeFormat: "24h" });
    expect(effectiveTimePrefs(org, null)).toEqual(org);
  });
  it("an invalid stored zone never breaks rendering", () => {
    expect(effectiveTimePrefs({ timeZone: "Bad/Zone", timeFormat: "12h" }, { timeZone: "Also/Bad", timeFormat: null }).timeZone).toBe("America/Toronto");
  });
});

describe("wall time <-> UTC", () => {
  it("round-trips, including half-hour zones", () => {
    for (const tz of ["America/Toronto", "America/St_Johns", "America/Regina", "America/Los_Angeles", "UTC"]) {
      expect(wallTimeToUtc(toWallTime("2026-09-25T19:52:00Z", tz), tz).toISOString()).toBe("2026-09-25T19:52:00.000Z");
    }
    expect(toWallTime("2026-09-25T19:52:00Z", "America/Toronto")).toBe("2026-09-25T15:52");
    expect(toWallTime("2026-09-25T19:52:00Z", "America/St_Johns")).toBe("2026-09-25T17:22");
  });
  it("DST gap (spring forward) and overlap (fall back)", () => {
    // 2:30 AM doesn't exist on 2026-03-08 in Toronto → 3:30 AM EDT (07:30Z), as browsers do
    expect(wallTimeToUtc("2026-03-08T02:30", "America/Toronto").toISOString()).toBe("2026-03-08T07:30:00.000Z");
    // 1:30 AM happens twice on 2026-11-01 → the first (EDT, 05:30Z)
    expect(wallTimeToUtc("2026-11-01T01:30", "America/Toronto").toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(wallTimeToUtc("2026-11-01T03:00", "America/Toronto").toISOString()).toBe("2026-11-01T08:00:00.000Z");
    expect(Number.isNaN(wallTimeToUtc("nope", "UTC").getTime())).toBe(true);
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
