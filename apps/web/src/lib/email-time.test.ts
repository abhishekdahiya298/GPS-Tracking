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

describe("renewal emails", () => {
  it("say what expires and when, as a calendar day", async () => {
    const { renewalEmail } = await import("./email");
    const soon = renewalEmail("a@x.test", "A", { orgName: "Org", vehicleName: "Truck 7", title: "Plate sticker", type: "registration", state: "due_soon", dueDate: "2026-10-31", daysRemaining: 12 }, "https://gps.example/maintenance/renewals");
    expect(soon.subject).toBe("RIO GPS renewal: Truck 7: Plate sticker expires in 12 days");
    expect(soon.text).toContain("Due date: Oct 31, 2026");
    expect(soon.text).toContain("Registration / plate");
    const late = renewalEmail("a@x.test", "A", { orgName: "Org", vehicleName: null, title: "<b>Policy</b>", type: "insurance", state: "overdue", dueDate: "2026-10-01", daysRemaining: -4 }, "https://gps.example/maintenance/renewals");
    expect(late.subject).toBe("RIO GPS renewal: <b>Policy</b> expired 4 days ago");
    expect(late.html).not.toContain("<b>Policy</b>"); // escaped in HTML
  });
});
