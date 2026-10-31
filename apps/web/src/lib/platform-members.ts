import type { TenantContext } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { eq } from "drizzle-orm";
import type { AuthenticatedUser } from "./authz";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors";

/**
 * The tenant context a platform admin acts in when managing a customer's users from the
 * platform console (same rules as View as customer: role null, full access, audited as them).
 * Archived customers are read-only until restored.
 */
export async function platformCustomerContext(user: AuthenticatedUser, organizationId: string): Promise<TenantContext> {
  if (!user.isSuperAdmin) throw new ForbiddenError();
  const [org] = await getDb().select({ id: schema.organizations.id, status: schema.organizations.status }).from(schema.organizations).where(eq(schema.organizations.id, organizationId));
  if (!org) throw new NotFoundError("Customer not found");
  if (org.status === "archived") throw new ConflictError("This customer is archived. Restore it before changing its users.");
  return { userId: user.userId, organizationId: org.id, role: null, isSuperAdmin: true };
}
