/**
 * RIO GPS authorization model — the single source of truth for who may do what.
 * Route handlers must never check roles directly; they call requirePermission()
 * (apps/web/src/lib/authz.ts), which consults this map.
 *
 * SUPER_ADMIN is a platform flag (users.is_super_admin), not a membership role.
 * Everything else is scoped to one organization via memberships.role.
 */
export const ORG_ROLES = ["ORG_ADMIN", "FLEET_MANAGER", "DISPATCHER", "VIEWER"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const PERMISSIONS = [
  "vehicles.read",
  "vehicles.create",
  "vehicles.update",
  "vehicles.delete",
  "devices.read",
  "devices.assign",
  "devices.unassign",
  "devices.manage",
  "locations.read",
  "history.read",
  "geofences.read",
  "geofences.write",
  "alerts.read",
  "alerts.write",
  "reports.manage",
  "maintenance.read",
  "maintenance.write",
  "loads.read",
  "loads.write",
  "users.read",
  "users.manage",
  "organization.manage",
  "billing.read",
  "billing.manage",
  "audit.read"
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const READ_ONLY: readonly Permission[] = [
  "vehicles.read",
  "devices.read",
  "locations.read",
  "history.read",
  "geofences.read",
  "alerts.read",
  "maintenance.read",
  "loads.read"
];

export const ROLE_PERMISSIONS: Readonly<Record<OrgRole, ReadonlySet<Permission>>> = {
  ORG_ADMIN: new Set<Permission>(PERMISSIONS),
  FLEET_MANAGER: new Set<Permission>([
    ...READ_ONLY,
    "vehicles.create",
    "vehicles.update",
    "vehicles.delete",
    "devices.assign",
    "devices.unassign",
    "geofences.write",
    "alerts.write",
    "reports.manage",
    "maintenance.write",
    "loads.write",
    "users.read"
  ]),
  // Dispatchers (a broker's load coordinators) create and run loads.
  DISPATCHER: new Set<Permission>([...READ_ONLY, "alerts.write", "loads.write"]),
  VIEWER: new Set<Permission>(READ_ONLY)
};

export function roleHasPermission(role: OrgRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/**
 * Product modules a customer's plan switches on. A permission that belongs to a module is only
 * granted when the organization's plan includes it, for everyone (platform admins viewing the
 * customer included, so they see exactly what the customer bought). Permissions outside every
 * module (team, settings, alerts, billing) are always available.
 */
export const MODULES = ["gps", "loads"] as const;
export type Module = (typeof MODULES)[number];

export const MODULE_PERMISSIONS: Readonly<Record<Module, readonly Permission[]>> = {
  gps: [
    "vehicles.read",
    "vehicles.create",
    "vehicles.update",
    "vehicles.delete",
    "devices.read",
    "devices.assign",
    "devices.unassign",
    "devices.manage",
    "locations.read",
    "history.read",
    "geofences.read",
    "geofences.write",
    "reports.manage",
    "maintenance.read",
    "maintenance.write"
  ],
  loads: ["loads.read", "loads.write"]
};

const PERMISSION_MODULE = new Map<Permission, Module>(MODULES.flatMap((m) => MODULE_PERMISSIONS[m].map((p) => [p, m] as const)));

/** The module a permission belongs to, or null when every plan has it. */
export function moduleOf(permission: Permission): Module | null {
  return PERMISSION_MODULE.get(permission) ?? null;
}

/** Server-derived authorization context for one request. Never built from client input. */
export interface TenantContext {
  userId: string;
  organizationId: string;
  /** null only for a SUPER_ADMIN acting in an organization they are not a member of. */
  role: OrgRole | null;
  isSuperAdmin: boolean;
  /**
   * Modules in the organization's plan. Every request context is built with it
   * (resolveTenantContext); internal helpers that act for the platform may leave it out,
   * which means "not limited by plan".
   */
  modules?: readonly Module[];
}

export function contextHasModule(ctx: TenantContext, module: Module): boolean {
  return ctx.modules === undefined || ctx.modules.includes(module);
}

export function contextHasPermission(ctx: TenantContext, permission: Permission): boolean {
  const m = moduleOf(permission);
  if (m && !contextHasModule(ctx, m)) return false;
  if (ctx.isSuperAdmin) return true;
  return ctx.role !== null && roleHasPermission(ctx.role, permission);
}
