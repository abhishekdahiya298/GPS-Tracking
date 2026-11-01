import { describe, expect, it } from "vitest";
import { contextHasPermission, MODULE_PERMISSIONS, MODULES, ORG_ROLES, PERMISSIONS, roleHasPermission, type TenantContext } from "./rbac.js";

const ctx = (over: Partial<TenantContext>): TenantContext => ({
  userId: "u",
  organizationId: "o",
  role: "VIEWER",
  isSuperAdmin: false,
  ...over
});

describe("RBAC", () => {
  it("ORG_ADMIN has every permission", () => {
    for (const p of PERMISSIONS) expect(roleHasPermission("ORG_ADMIN", p)).toBe(true);
  });

  it("VIEWER is read-only", () => {
    expect(roleHasPermission("VIEWER", "locations.read")).toBe(true);
    expect(roleHasPermission("VIEWER", "history.read")).toBe(true);
    for (const p of ["vehicles.create", "devices.assign", "users.manage", "billing.manage", "audit.read"] as const) {
      expect(roleHasPermission("VIEWER", p)).toBe(false);
    }
  });

  it("only ORG_ADMIN can manage users, billing and read audit logs", () => {
    for (const role of ORG_ROLES.filter((r) => r !== "ORG_ADMIN")) {
      expect(roleHasPermission(role, "users.manage")).toBe(false);
      expect(roleHasPermission(role, "billing.manage")).toBe(false);
      expect(roleHasPermission(role, "audit.read")).toBe(false);
    }
  });

  it("every role can read live locations", () => {
    for (const role of ORG_ROLES) expect(roleHasPermission(role, "locations.read")).toBe(true);
  });

  it("loads: every role reads, only viewers cannot write", () => {
    for (const role of ORG_ROLES) expect(roleHasPermission(role, "loads.read")).toBe(true);
    for (const role of ["ORG_ADMIN", "FLEET_MANAGER", "DISPATCHER"] as const) expect(roleHasPermission(role, "loads.write")).toBe(true);
    expect(roleHasPermission("VIEWER", "loads.write")).toBe(false);
  });

  it("SUPER_ADMIN is allowed everything, even without a membership role", () => {
    expect(contextHasPermission(ctx({ isSuperAdmin: true, role: null }), "billing.manage")).toBe(true);
  });

  it("a context without a role and without super admin is denied", () => {
    expect(contextHasPermission(ctx({ role: null }), "locations.read")).toBe(false);
  });
});

describe("plan modules", () => {
  const base: TenantContext = { userId: "u", organizationId: "o", role: "ORG_ADMIN", isSuperAdmin: false };
  it("a Loads-only plan hides fleet permissions, even from an org admin and a platform admin", () => {
    const loadsOnly = { ...base, modules: ["loads"] as const };
    expect(contextHasPermission(loadsOnly, "loads.write")).toBe(true);
    expect(contextHasPermission(loadsOnly, "locations.read")).toBe(false);
    expect(contextHasPermission(loadsOnly, "vehicles.read")).toBe(false);
    expect(contextHasPermission({ ...loadsOnly, role: null, isSuperAdmin: true }, "devices.read")).toBe(false);
  });
  it("a GPS-only plan hides loads; team, settings, alerts and billing are in every plan", () => {
    const gps = { ...base, modules: ["gps"] as const };
    expect(contextHasPermission(gps, "loads.read")).toBe(false);
    expect(contextHasPermission(gps, "locations.read")).toBe(true);
    for (const p of ["users.manage", "organization.manage", "alerts.read", "billing.read"] as const) expect(contextHasPermission(gps, p)).toBe(true);
  });
  it("every permission belongs to at most one module", () => {
    const all = MODULES.flatMap((m) => MODULE_PERMISSIONS[m]);
    expect(new Set(all).size).toBe(all.length);
  });
});
