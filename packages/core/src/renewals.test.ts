import { describe, expect, it } from "vitest";
import { renewalDueText, renewalStatus } from "./renewals.js";

describe("renewalStatus", () => {
  it("ok → due soon inside the reminder window → overdue the day after", () => {
    expect(renewalStatus("2026-12-31", 30, "2026-10-05")).toEqual({ state: "ok", daysRemaining: 87 });
    expect(renewalStatus("2026-12-31", 30, "2026-12-01")).toEqual({ state: "due_soon", daysRemaining: 30 });
    expect(renewalStatus("2026-12-31", 30, "2026-11-30")).toEqual({ state: "ok", daysRemaining: 31 });
    expect(renewalStatus("2026-12-31", 30, "2026-12-31")).toEqual({ state: "due_soon", daysRemaining: 0 }); // still valid on the day
    expect(renewalStatus("2026-12-31", 30, "2027-01-01")).toEqual({ state: "overdue", daysRemaining: -1 });
  });
  it("counts calendar days across DST changes and leap days", () => {
    expect(renewalStatus("2026-11-02", 0, "2026-11-01").daysRemaining).toBe(1); // 25-hour day in North America
    expect(renewalStatus("2028-03-01", 0, "2028-02-28").daysRemaining).toBe(2);
    expect(renewalStatus("2026-10-05", 0, "2026-10-05").state).toBe("due_soon");
  });
  it("text", () => {
    expect([0, 1, -1, 12, -3].map(renewalDueText)).toEqual(["today", "tomorrow", "yesterday", "in 12 days", "3 days ago"]);
  });
});
