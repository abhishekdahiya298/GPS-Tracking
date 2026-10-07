import { type OrgRole } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { and, asc, eq } from "drizzle-orm";
import { writeAudit } from "./audit";
import type { AuthenticatedUser } from "./authz";
import { NotFoundError } from "./errors";

type Meta = { ipAddress?: string | null; userAgent?: string | null };

export interface MyOrganization {
  id: string;
  name: string;
  role: OrgRole;
}

/** The companies this person belongs to. One account (one email) can belong to several. */
export async function listMyOrganizations(userId: string): Promise<MyOrganization[]> {
  const rows = await getDb()
    .select({ id: schema.organizations.id, name: schema.organizations.name, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.organizationId))
    .where(eq(schema.memberships.userId, userId))
    .orderBy(asc(schema.organizations.name));
  return rows.map((r) => ({ id: r.id, name: r.name, role: r.role as OrgRole }));
}

/**
 * Switches this session to another company the person is a member of. Membership is checked
 * here, and again on every request by resolveTenantContext, so the stored id grants nothing by itself.
 */
export async function switchOrganization(user: AuthenticatedUser, organizationId: string, meta: Meta) {
  const db = getDb();
  const [m] = await db
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.userId, user.userId), eq(schema.memberships.organizationId, organizationId)));
  // Same answer whether the company does not exist or the person is not in it.
  if (!m) throw new NotFoundError("Company not found");
  await db.update(schema.sessions).set({ activeOrganizationId: organizationId }).where(and(eq(schema.sessions.id, user.sessionId), eq(schema.sessions.userId, user.userId)));
  await writeAudit({ action: "auth.organization_switched", actorUserId: user.userId, organizationId, targetType: "organization", targetId: organizationId, ...meta });
}
