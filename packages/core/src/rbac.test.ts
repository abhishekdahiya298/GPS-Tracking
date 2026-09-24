import { describe, expect, it } from "vitest";
import { contextHasPermission, ORG_ROLES, PERMISSIONS, roleHasPermission, type TenantContext } from "./rbac.js";

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

  it("SUPER_ADMIN is allowed everything, even without a membership role", () => {
    expect(contextHasPermission(ctx({ isSuperAdmin: true, role: null }), "billing.manage")).toBe(true);
  });

  it("a context without a role and without super admin is denied", () => {
    expect(contextHasPermission(ctx({ role: null }), "locations.read")).toBe(false);
  });
});
