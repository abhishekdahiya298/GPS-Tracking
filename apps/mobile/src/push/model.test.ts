import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, clockText, isQuiet, parsePrefs, registrationBody, routeForNotification, wrapMinutes } from "./model";

describe("push choices", () => {
  it("starts switched off with every kind chosen", () => {
    expect(DEFAULT_PREFS).toEqual({ enabled: false, speeding: true, zones: true, offline: true, loads: true, quiet: false, quietStart: 1320, quietEnd: 360 });
  });
  it("reads saved choices and survives damaged or partial data", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("{not json")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('{"enabled":true,"zones":false,"offline":"yes"}')).toEqual({ ...DEFAULT_PREFS, enabled: true, zones: false });
    expect(parsePrefs('{"quiet":true,"quietStart":1500,"quietEnd":"x"}')).toMatchObject({ quiet: true, quietStart: 60, quietEnd: 360 });
  });
  it("builds what the server expects", () => {
    expect(registrationBody("ExponentPushToken[x]", "ios", { ...DEFAULT_PREFS, enabled: true, loads: false })).toEqual({
      token: "ExponentPushToken[x]", platform: "ios", speeding: true, zones: true, offline: true, maintenance: false, loads: false, quietStart: null, quietEnd: null, timeZone: null
    });
  });
  it("sends quiet hours only when they are on, differ, and the time zone is known", () => {
    const on = { ...DEFAULT_PREFS, enabled: true, quiet: true };
    expect(registrationBody("t", "ios", on, "Asia/Kolkata")).toMatchObject({ quietStart: 1320, quietEnd: 360, timeZone: "Asia/Kolkata" });
    expect(registrationBody("t", "ios", on, null)).toMatchObject({ quietStart: null, timeZone: null });
    expect(registrationBody("t", "ios", { ...on, quietEnd: 1320 }, "Asia/Kolkata")).toMatchObject({ quietStart: null });
  });
  it("knows when it is quiet, also across midnight", () => {
    expect(isQuiet(23 * 60, 1320, 360)).toBe(true);
    expect(isQuiet(5 * 60, 1320, 360)).toBe(true);
    expect(isQuiet(6 * 60, 1320, 360)).toBe(false);
    expect(isQuiet(12 * 60, 1320, 360)).toBe(false);
    expect(isQuiet(13 * 60, 12 * 60, 14 * 60)).toBe(true);
    expect(isQuiet(15 * 60, 12 * 60, 14 * 60)).toBe(false);
    expect(isQuiet(100, 600, 600)).toBe(false);
  });
  it("shows times of day in both clock styles and wraps around midnight", () => {
    expect(clockText(1320, "12h")).toBe("10:00 PM");
    expect(clockText(0, "12h")).toBe("12:00 AM");
    expect(clockText(750, "12h")).toBe("12:30 PM");
    expect(clockText(390, "24h")).toBe("06:30");
    expect(wrapMinutes(-30)).toBe(1410);
    expect(wrapMinutes(1470)).toBe(30);
  });
  it("opens the Alerts tab for an alert notification and nothing for anything else", () => {
    expect(routeForNotification({ alertId: 12, type: "speeding" })).toBe("/(tabs)/alerts");
    expect(routeForNotification({ type: "load_late" })).toBe("/(tabs)/alerts");
    expect(routeForNotification({})).toBeNull();
    expect(routeForNotification(null)).toBeNull();
    expect(routeForNotification("x")).toBeNull();
  });
});
