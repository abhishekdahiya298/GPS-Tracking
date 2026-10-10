import { describe, expect, it } from "vitest";
import { advance, buildTrack, dayLabel, dayRange, durationText, positionAt, progressOf, shiftDay, timeAtProgress, todayKey, trackBounds, type HistoryPoint } from "./model";

const TZ = "America/Toronto";
const pt = (iso: string, lat: number, lng: number, speedKph: number | null = 50): HistoryPoint => ({ recordedAt: iso, latitude: lat, longitude: lng, speedKph, headingDeg: null });

describe("days in the organization's time zone", () => {
  it("knows today's date there, not on the phone", () => {
    // 02:30 UTC on Oct 10 is still Oct 9 in Toronto.
    expect(todayKey(TZ, Date.parse("2026-10-10T02:30:00Z"))).toBe("2026-10-09");
    expect(todayKey("Asia/Kolkata", Date.parse("2026-10-09T20:00:00Z"))).toBe("2026-10-10");
  });
  it("gives the instants a day starts and ends, including clock-change days", () => {
    expect(dayRange("2026-10-09", TZ)).toEqual({ from: "2026-10-09T04:00:00.000Z", to: "2026-10-10T04:00:00.000Z" });
    const fall = dayRange("2026-11-01", TZ); // clocks go back: a 25-hour day
    expect((Date.parse(fall.to) - Date.parse(fall.from)) / 3_600_000).toBe(25);
    const spring = dayRange("2026-03-08", TZ); // clocks go forward: a 23-hour day
    expect((Date.parse(spring.to) - Date.parse(spring.from)) / 3_600_000).toBe(23);
  });
  it("moves by days across months and never past today", () => {
    expect(shiftDay("2026-10-01", -1, "2026-10-09")).toBe("2026-09-30");
    expect(shiftDay("2026-10-08", 1, "2026-10-09")).toBe("2026-10-09");
    expect(shiftDay("2026-10-09", 1, "2026-10-09")).toBe("2026-10-09");
  });
  it("labels days the way people say them", () => {
    expect(dayLabel("2026-10-09", "2026-10-09")).toBe("Today");
    expect(dayLabel("2026-10-08", "2026-10-09")).toBe("Yesterday");
    expect(dayLabel("2026-10-01", "2026-10-09")).toBe("Thu, Oct 1, 2026");
  });
  it("writes durations", () => {
    expect([0, 45, 60, 125, 59.6].map(durationText)).toEqual(["0 min", "45 min", "1 h 00 min", "2 h 05 min", "1 h 00 min"]);
  });
});

describe("playback", () => {
  const track = buildTrack([pt("2026-10-09T12:00:00Z", 43.0, -79.0, 0), pt("2026-10-09T12:10:00Z", 43.0, -78.0, 80), pt("2026-10-09T12:30:00Z", 44.0, -78.0, 60)])!;

  it("builds a clean track: time order, no duplicates, no empty positions", () => {
    const messy = buildTrack([pt("2026-10-09T12:10:00Z", 43, -78), pt("2026-10-09T12:00:00Z", 43, -79), pt("2026-10-09T12:10:00Z", 50, -70), pt("2026-10-09T12:05:00Z", 0, 0), pt("bad", 43, -79)])!;
    expect(messy.at).toEqual([[-79, 43], [-78, 43]]);
    expect(buildTrack([pt("2026-10-09T12:00:00Z", 43, -79)])).toBeNull();
    expect(buildTrack([])).toBeNull();
  });
  it("places the vehicle between recorded points", () => {
    expect(positionAt(track, track.startT)).toMatchObject({ at: [-79, 43], index: 0 });
    expect(positionAt(track, track.startT + 5 * 60_000)).toMatchObject({ at: [-78.5, 43], speedKph: 0, index: 0 });
    const later = positionAt(track, track.startT + 20 * 60_000);
    expect(later.at[0]).toBeCloseTo(-78);
    expect(later.at[1]).toBeCloseTo(43.5);
    expect(later).toMatchObject({ speedKph: 80, index: 1 });
    expect(positionAt(track, track.endT + 1)).toMatchObject({ at: [-78, 44], index: 2 });
    expect(positionAt(track, track.startT - 1)).toMatchObject({ at: [-79, 43], index: 0 });
  });
  it("plays any trip in about a minute at 1x and stops exactly at the end", () => {
    // 30-minute trip: one real second at 1x is 30 trip-seconds.
    expect(advance(track, track.startT, 1000, 1) - track.startT).toBe(30_000);
    expect(advance(track, track.startT, 1000, 4) - track.startT).toBe(120_000);
    expect(advance(track, track.endT - 10, 5000, 1)).toBe(track.endT);
    expect(advance(track, track.startT, 60_000, 1)).toBe(track.endT);
  });
  it("converts between time and the progress bar", () => {
    expect(progressOf(track, track.startT + 15 * 60_000)).toBe(0.5);
    expect(timeAtProgress(track, 0.5)).toBe(track.startT + 15 * 60_000);
    expect(timeAtProgress(track, 2)).toBe(track.endT);
    expect(progressOf(track, track.startT - 5)).toBe(0);
  });
  it("frames the whole route, and a tiny one is not zoomed to a point", () => {
    expect(trackBounds(track)).toEqual([-79, 43, -78, 44]);
    const tiny = buildTrack([pt("2026-10-09T12:00:00Z", 43, -79), pt("2026-10-09T12:01:00Z", 43.0001, -79.0001)])!;
    const [w, s, e, n] = trackBounds(tiny);
    expect(e - w).toBeCloseTo(0.01);
    expect(n - s).toBeCloseTo(0.01);
  });
});
