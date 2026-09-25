import { requireAuthenticatedUser, type AuthenticatedUser } from "./authz";
import { ForbiddenError } from "./errors";

/** Platform operations: super admin only (not an organization role). */
export async function requireSuperAdmin(request: Request): Promise<AuthenticatedUser> {
  const user = await requireAuthenticatedUser(request);
  if (!user.isSuperAdmin) throw new ForbiddenError();
  return user;
}
