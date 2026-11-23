import { getDb, schema } from "@rio-gps/db";
import { verifyPassword } from "better-auth/crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "./audit";
import { ConflictError, ForbiddenError, ValidationError } from "./errors";

export const DeleteAccountSchema = z.object({
  password: z.string().min(1, "Enter your password").max(128),
  confirm: z.literal("DELETE", { errorMap: () => ({ message: "Type DELETE to confirm" }) })
});

/**
 * Deletes the signed-in person's account (required by the app stores for public sign-up).
 * A company left with no one in it is archived (restorable by RIO GPS, data kept for its
 * retention period). A company with other people needs another admin first.
 */
export async function deleteOwnAccount(userId: string, input: z.infer<typeof DeleteAccountSchema>, meta: { ipAddress: string | null; userAgent: string | null }): Promise<{ archived: string[] }> {
  const db = getDb();
  const [user] = await db.select({ id: schema.users.id, email: schema.users.email, isSuperAdmin: schema.users.isSuperAdmin }).from(schema.users).where(eq(schema.users.id, userId));
  if (!user) throw new ValidationError("Account not found");
  if (user.isSuperAdmin) throw new ForbiddenError("Platform admin accounts are removed by another platform admin.");
  const [acct] = await db.select({ password: schema.accounts.password }).from(schema.accounts).where(and(eq(schema.accounts.userId, userId), eq(schema.accounts.providerId, "credential")));
  if (!acct?.password || !(await verifyPassword({ hash: acct.password, password: input.password }))) throw new ValidationError("That password isn't right.");

  const archived: string[] = [];
  await db.transaction(async (tx) => {
    const mine = await tx
      .select({ orgId: schema.memberships.organizationId, role: schema.memberships.role, name: schema.organizations.name })
      .from(schema.memberships)
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.organizationId))
      .where(eq(schema.memberships.userId, userId));
    for (const m of mine) {
      const [others] = await tx
        .select({ n: sql<number>`count(*)::int`, admins: sql<number>`count(*) filter (where ${schema.memberships.role} = 'ORG_ADMIN')::int` })
        .from(schema.memberships)
        .where(and(eq(schema.memberships.organizationId, m.orgId), ne(schema.memberships.userId, userId)));
      if ((others?.n ?? 0) === 0) {
        await tx.update(schema.organizations).set({ status: "archived", statusReason: "The only member deleted their account", statusChangedAt: new Date(), updatedAt: new Date() }).where(eq(schema.organizations.id, m.orgId));
        archived.push(m.name);
      } else if (m.role === "ORG_ADMIN" && (others?.admins ?? 0) === 0) {
        throw new ConflictError(`Make another team member an admin of ${m.name} first (Team page), then delete your account.`);
      }
    }
    await tx.delete(schema.users).where(eq(schema.users.id, userId));
  });
  await writeAudit({ action: "account.deleted", actorUserId: null, targetType: "user", targetId: userId, metadata: { archivedCompanies: archived }, ...meta });
  return { archived };
}
