import { describe, expect, it } from "vitest";
import { buildNav, isActive, PLATFORM_NAV } from "./nav-config";

const labels = (ctx: Parameters<typeof buildNav>[0]) => buildNav(ctx).flatMap((s) => s.items.map((i) => i.label));
const base = { userId: "u", organizationId: "o", isSuperAdmin: false };

describe("navigation respects RBAC", () => {
  it("VIEWER sees read-only areas but not Team or Customers", () => {
    const l = labels({ ...base, role: "VIEWER" });
    expect(l).toEqual(expect.arrayContaining(["Dashboard", "Live tracking", "Loads", "Vehicles", "Zones", "Alerts", "Reports", "Maintenance"]));
    expect(l).not.toContain("Team");
    expect(l).not.toContain("Customers");
  });
  it("ORG_ADMIN sees Team but not Customers", () => {
    const l = labels({ ...base, role: "ORG_ADMIN" });
    expect(l).toContain("Team");
    expect(l).not.toContain("Customers");
  });
  it("only platform admins (viewing a customer) get the way back to the platform console", () => {
    expect(labels({ ...base, role: null, isSuperAdmin: true })).toContain("Platform console");
    expect(labels({ ...base, role: "ORG_ADMIN" })).not.toContain("Platform console");
    expect(labels({ ...base, role: null, isSuperAdmin: true })).toContain("Team");
  });
  it("the platform overview is active only on its own page", () => {
    const overview = PLATFORM_NAV[0]!.items[0]!;
    expect(isActive("/admin", overview)).toBe(true);
    expect(isActive("/admin/customers", overview)).toBe(false);
  });
  it("active matching covers sub-pages and aliases", () => {
    expect(isActive("/reports/schedules", { href: "/reports", label: "R", icon: "reports" })).toBe(true);
    expect(isActive("/zones", { href: "/geofences", label: "Z", icon: "zones", match: ["/zones"] })).toBe(true);
    expect(isActive("/reportsx", { href: "/reports", label: "R", icon: "reports" })).toBe(false);
  });
});
