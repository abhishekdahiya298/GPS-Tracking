import { describe, expect, it } from "vitest";
import { alertEmail } from "./email";

const ev = { type: "speeding", ruleName: "Highway", vehicleName: "Truck 7", occurredAt: "2026-09-25T19:52:07Z", latitude: null, longitude: null, details: null };

describe("alert emails use the recipient's time zone and clock", () => {
  it("Toronto, 12-hour", () => {
    const m = alertEmail("a@x.test", "A", ev, "https://gps.example/alerts", "imperial", { timeZone: "America/Toronto", timeFormat: "12h" });
    expect(m.text).toContain("Time: Sep 25, 2026, 3:52:07 PM EDT");
    expect(m.html).toContain("fired at Sep 25, 2026, 3:52:07 PM EDT");
  });
  it("Vancouver, 24-hour", () => {
    const m = alertEmail("a@x.test", "A", ev, "https://gps.example/alerts", "metric", { timeZone: "America/Vancouver", timeFormat: "24h" });
    expect(m.text).toContain("Time: Sep 25, 2026, 12:52:07 PDT");
  });
  it("Newfoundland (half-hour offset)", () => {
    const m = alertEmail("a@x.test", "A", ev, "https://gps.example/alerts", "metric", { timeZone: "America/St_Johns", timeFormat: "12h" });
    expect(m.text).toContain("5:22:07 PM NDT");
  });
});
