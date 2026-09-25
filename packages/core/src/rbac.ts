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
  "locations.read",
  "history.read",
  "geofences.read",
  "geofences.write",
  "alerts.read",
  "alerts.write",
  "reports.manage",
  "users.read",
  "users.manage",
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
  "alerts.read"
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
    "users.read"
  ]),
  DISPATCHER: new Set<Permission>([...READ_ONLY, "alerts.write"]),
  VIEWER: new Set<Permission>(READ_ONLY)
};

export function roleHasPermission(role: OrgRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/** Server-derived authorization context for one request. Never built from client input. */
export interface TenantContext {
  userId: string;
  organizationId: string;
  /** null only for a SUPER_ADMIN acting in an organization they are not a member of. */
  role: OrgRole | null;
  isSuperAdmin: boolean;
}

export function contextHasPermission(ctx: TenantContext, permission: Permission): boolean {
  if (ctx.isSuperAdmin) return true;
  return ctx.role !== null && roleHasPermission(ctx.role, permission);
}
