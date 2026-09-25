import { describe, expect, it } from "vitest";
import { maintenanceStatus } from "./maintenance.js";

const at = new Date("2026-01-01T00:00:00Z");
const now = new Date("2026-03-01T00:00:00Z"); // 59 days later

describe("maintenanceStatus", () => {
  it("distance only", () => {
    expect(maintenanceStatus({ intervalKm: 10000, intervalDays: null, lastServiceAt: at }, 5000, now)).toMatchObject({ state: "ok", kmRemaining: 5000, daysRemaining: null });
    expect(maintenanceStatus({ intervalKm: 10000, intervalDays: null, lastServiceAt: at }, 9100, now).state).toBe("due_soon");
    expect(maintenanceStatus({ intervalKm: 10000, intervalDays: null, lastServiceAt: at }, 10000, now).state).toBe("overdue");
    expect(maintenanceStatus({ intervalKm: 1000, intervalDays: null, lastServiceAt: at }, 750, now).state).toBe("due_soon"); // min 300 km window
  });
  it("time only", () => {
    const s = maintenanceStatus({ intervalKm: null, intervalDays: 90, lastServiceAt: at }, 0, now);
    expect(s).toMatchObject({ state: "ok", daysRemaining: 31, dueDate: "2026-04-01" });
    expect(maintenanceStatus({ intervalKm: null, intervalDays: 60, lastServiceAt: at }, 0, now)).toMatchObject({ state: "due_soon", daysRemaining: 1 });
    expect(maintenanceStatus({ intervalKm: null, intervalDays: 59, lastServiceAt: at }, 0, now).state).toBe("overdue");
  });
  it("whichever comes first", () => {
    expect(maintenanceStatus({ intervalKm: 10000, intervalDays: 30, lastServiceAt: at }, 100, now).state).toBe("overdue");
    expect(maintenanceStatus({ intervalKm: 1000, intervalDays: 365, lastServiceAt: at }, 1200, now)).toMatchObject({ state: "overdue", kmRemaining: -200 });
  });
});
