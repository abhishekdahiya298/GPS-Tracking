import { ORG_ROLES, type OrgRole } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

/**
 * Operator-only user provisioning (public sign-up is disabled). Used by
 * scripts/create-user.ts; runs server-side with direct DB access, never exposed
 * over HTTP. The password is hashed with Better Auth's own hasher so the
 * resulting credential account signs in through /api/auth/sign-in/email.
 */
export const CreateUserInputSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1).max(200),
  password: z.string().min(12).max(128),
  organizationSlug: z.string().trim().min(1),
  role: z.enum(ORG_ROLES),
  superAdmin: z.boolean().default(false)
});
export type CreateUserInput = z.input<typeof CreateUserInputSchema>;

export interface CreateUserResult {
  userId: string;
  organizationId: string;
  role: OrgRole;
  created: boolean;
}

export class ProvisioningError extends Error {}

export async function createUserWithMembership(raw: CreateUserInput): Promise<CreateUserResult> {
  const input = CreateUserInputSchema.parse(raw);
  const db = getDb();

  const [org] = await db
    .select({ id: schema.organizations.id })
    .from(schema.organizations)
    .where(eq(schema.organizations.slug, input.organizationSlug))
    .limit(1);
  if (!org) throw new ProvisioningError(`Organization '${input.organizationSlug}' not found`);

  const passwordHash = await hashPassword(input.password);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, input.email))
      .limit(1);
    if (existing) {
      throw new ProvisioningError(
        `A user with this email already exists; use the membership tooling instead of re-creating it`
      );
    }

    const [user] = await tx
      .insert(schema.users)
      .values({
        email: input.email,
        name: input.name,
        emailVerified: true,
        isSuperAdmin: input.superAdmin
      })
      .returning({ id: schema.users.id });
    if (!user) throw new Error("user insert returned no row");

    await tx.insert(schema.accounts).values({
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: passwordHash
    });

    await tx.insert(schema.memberships).values({
      userId: user.id,
      organizationId: org.id,
      role: input.role
    });

    // Audited in the same transaction: a user never exists without its trail.
    await tx.insert(schema.auditLogs).values({
      action: "user.created",
      actorUserId: null,
      organizationId: org.id,
      targetType: "user",
      targetId: user.id,
      metadata: { via: "cli", role: input.role, superAdmin: input.superAdmin }
    });

    return { userId: user.id, organizationId: org.id, role: input.role, created: true };
  });
}

/** Adds (or changes) a membership for an existing user. */
export async function upsertMembership(email: string, organizationSlug: string, role: OrgRole) {
  const db = getDb();
  const [user] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email.trim().toLowerCase())).limit(1);
  const [org] = await db.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.slug, organizationSlug)).limit(1);
  if (!user || !org) throw new ProvisioningError("User or organization not found");
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.memberships)
      .values({ userId: user.id, organizationId: org.id, role })
      .onConflictDoUpdate({
        target: [schema.memberships.userId, schema.memberships.organizationId],
        set: { role, updatedAt: new Date() }
      });
    await tx.insert(schema.auditLogs).values({
      action: "membership.upserted",
      organizationId: org.id,
      targetType: "user",
      targetId: user.id,
      metadata: { via: "cli", role }
    });
  });
  const [m] = await db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.userId, user.id), eq(schema.memberships.organizationId, org.id)));
  return m;
}
