import { describe, expect, it } from "vitest";
import { buildNav, isActive } from "./nav-config";

const labels = (ctx: Parameters<typeof buildNav>[0]) => buildNav(ctx).flatMap((s) => s.items.map((i) => i.label));
const base = { userId: "u", organizationId: "o", isSuperAdmin: false };

describe("navigation respects RBAC", () => {
  it("VIEWER sees read-only areas but not Team or Customers", () => {
    const l = labels({ ...base, role: "VIEWER" });
    expect(l).toEqual(expect.arrayContaining(["Dashboard", "Live tracking", "Vehicles", "Zones", "Alerts", "Reports", "Maintenance"]));
    expect(l).not.toContain("Team");
    expect(l).not.toContain("Customers");
  });
  it("ORG_ADMIN sees Team but not Customers", () => {
    const l = labels({ ...base, role: "ORG_ADMIN" });
    expect(l).toContain("Team");
    expect(l).not.toContain("Customers");
  });
  it("only super admins see Customers", () => {
    expect(labels({ ...base, role: "ORG_ADMIN", isSuperAdmin: true })).toContain("Customers");
    expect(labels({ ...base, role: null, isSuperAdmin: true })).toContain("Customers");
  });
  it("active matching covers sub-pages and aliases", () => {
    expect(isActive("/reports/schedules", { href: "/reports", label: "R", icon: "reports" })).toBe(true);
    expect(isActive("/zones", { href: "/geofences", label: "Z", icon: "zones", match: ["/zones"] })).toBe(true);
    expect(isActive("/reportsx", { href: "/reports", label: "R", icon: "reports" })).toBe(false);
  });
});
