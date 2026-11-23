import { describe, expect, it } from "vitest";
import { atLimit, cleanFeatures, cleanLimits, DEFAULT_FEATURE_RULES, featureOf } from "./plan-features.js";
import { contextHasPermission, type TenantContext } from "./rbac.js";

const base: TenantContext = { userId: "u", organizationId: "o", role: "ORG_ADMIN", isSuperAdmin: false };

describe("plan features", () => {
  it("locks the permissions of a feature that isn't in the plan", () => {
    const ctx = { ...base, lockedFeatures: ["alerts", "gps_trackers"] as const };
    expect(contextHasPermission(ctx, "alerts.read")).toBe(false);
    expect(contextHasPermission(ctx, "devices.assign")).toBe(false);
    expect(contextHasPermission(ctx, "vehicles.create")).toBe(true);
    expect(contextHasPermission(base, "alerts.read")).toBe(true);
  });

  it("platform admins viewing a customer see the customer's locks too", () => {
    const ctx: TenantContext = { ...base, role: null, isSuperAdmin: true, lockedFeatures: ["zones"] };
    expect(contextHasPermission(ctx, "geofences.read")).toBe(false);
    expect(contextHasPermission(ctx, "loads.read")).toBe(true);
  });

  it("maps permissions to features", () => {
    expect(featureOf("maintenance.write")).toBe("maintenance");
    expect(featureOf("billing.read")).toBeNull();
  });

  it("cleans stored values", () => {
    expect(cleanFeatures(["zones", "zones", "nope", "alerts"])).toEqual(["alerts", "zones"]);
    expect(cleanLimits({ vehicles: 2, drivers: -1, members: "3", historyDays: 1.7, junk: 4 })).toEqual({ vehicles: 2, historyDays: 1 });
  });

  it("knows when a limit is reached", () => {
    expect(atLimit({ vehicles: 2 }, "vehicles", 2)).toBe(true);
    expect(atLimit({ vehicles: 2 }, "vehicles", 1)).toBe(false);
    expect(atLimit({}, "vehicles", 1000)).toBe(false);
  });

  it("hides loads-only extras by default and locks the rest", () => {
    expect(DEFAULT_FEATURE_RULES.loads_map).toBe("hide");
    expect(DEFAULT_FEATURE_RULES.alerts).toBe("lock");
  });
});
