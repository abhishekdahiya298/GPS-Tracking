import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, parsePrefs, registrationBody, routeForNotification } from "./model";

describe("push choices", () => {
  it("starts switched off with every kind chosen", () => {
    expect(DEFAULT_PREFS).toEqual({ enabled: false, speeding: true, zones: true, offline: true, loads: true });
  });
  it("reads saved choices and survives damaged or partial data", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("{not json")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('{"enabled":true,"zones":false,"offline":"yes"}')).toEqual({ enabled: true, speeding: true, zones: false, offline: true, loads: true });
  });
  it("builds what the server expects", () => {
    expect(registrationBody("ExponentPushToken[x]", "ios", { ...DEFAULT_PREFS, enabled: true, loads: false })).toEqual({
      token: "ExponentPushToken[x]", platform: "ios", speeding: true, zones: true, offline: true, maintenance: false, loads: false
    });
  });
  it("opens the Alerts tab for an alert notification and nothing for anything else", () => {
    expect(routeForNotification({ alertId: 12, type: "speeding" })).toBe("/(tabs)/alerts");
    expect(routeForNotification({ type: "load_late" })).toBe("/(tabs)/alerts");
    expect(routeForNotification({})).toBeNull();
    expect(routeForNotification(null)).toBeNull();
    expect(routeForNotification("x")).toBeNull();
  });
});
