import { contextHasPermission, ORG_ROLES, type OrgRole, type Permission, type TenantContext } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { and, asc, eq } from "drizzle-orm";
import { getAuth } from "./auth";
import { ForbiddenError, OrganizationUnavailableError, PlatformOnlyError, UnauthenticatedError } from "./errors";

/**
 * The single authorization choke point. Every tenant-scoped route calls
 * requireTenantContext() and then requirePermission(). organizationId, userId
 * and role are derived here from the server-side session + memberships table —
 * never from the request body, query string or client headers.
 */
export interface AuthenticatedUser {
  userId: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
  sessionId: string;
  activeOrganizationId: string | null;
}

export async function requireAuthenticatedUser(request: Request): Promise<AuthenticatedUser> {
  return requireAuthenticatedUserFromHeaders(request.headers);
}

/** Same as requireAuthenticatedUser, for Server Components (next/headers). */
export async function requireAuthenticatedUserFromHeaders(headers: Headers): Promise<AuthenticatedUser> {
  const result = await getAuth().api.getSession({ headers });
  if (!result) {
    throw new UnauthenticatedError();
  }
  const { user, session } = result;
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    isSuperAdmin: (user as { isSuperAdmin?: boolean }).isSuperAdmin === true,
    sessionId: session.id,
    activeOrganizationId: (session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null
  };
}

function isOrgRole(value: string): value is OrgRole {
  return (ORG_ROLES as readonly string[]).includes(value);
}

/**
 * Resolves which organization this request acts in, strictly from memberships.
 *
 * Platform admins (users.is_super_admin) are never organization members: they act in a customer
 * only after choosing it with "View as customer" (session.activeOrganizationId, audited), with
 * full access (role null). With no customer chosen they get PlatformOnlyError, which the pages
 * turn into the platform console. Any membership rows a platform admin still has are ignored.
 *
 * Everyone else can only act in an active organization they belong to; suspended and archived
 * organizations are skipped, and if nothing is left the request is refused.
 */
export async function resolveTenantContext(user: AuthenticatedUser): Promise<TenantContext> {
  const db = getDb();
  if (user.isSuperAdmin) {
    if (user.activeOrganizationId) {
      const [org] = await db
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, user.activeOrganizationId))
        .limit(1);
      if (org) return { userId: user.userId, organizationId: org.id, role: null, isSuperAdmin: true };
    }
    throw new PlatformOnlyError();
  }

  const rows = await db
    .select({ organizationId: schema.memberships.organizationId, role: schema.memberships.role, status: schema.organizations.status })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.organizationId))
    .where(eq(schema.memberships.userId, user.userId))
    .orderBy(asc(schema.memberships.createdAt));
  const usable = rows.filter((m) => m.status === "active");

  const membership = (user.activeOrganizationId ? usable.find((m) => m.organizationId === user.activeOrganizationId) : undefined) ?? usable[0];
  if (membership && isOrgRole(membership.role)) {
    return { userId: user.userId, organizationId: membership.organizationId, role: membership.role, isSuperAdmin: false };
  }
  if (rows.length > 0) throw new OrganizationUnavailableError(rows.some((r) => r.status === "suspended") ? "suspended" : "archived");
  throw new ForbiddenError("Your account is not a member of any organization");
}

export async function requireTenantContext(request: Request): Promise<TenantContext> {
  return resolveTenantContext(await requireAuthenticatedUser(request));
}

export function requirePermission(ctx: TenantContext, permission: Permission): void {
  if (!contextHasPermission(ctx, permission)) {
    throw new ForbiddenError();
  }
}

/** Convenience for membership checks that must not reveal whether the org exists. */
export async function hasMembership(userId: string, organizationId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.organizationId, organizationId)))
    .limit(1);
  return Boolean(row);
}
