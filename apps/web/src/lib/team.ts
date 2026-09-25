import { ORG_ROLES, type OrgRole, type TenantContext } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { hashPassword } from "better-auth/crypto";
import { and, asc, count, eq, max, ne } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "./audit";
import { getAuth } from "./auth";
import { accessGrantedEmail, inviteEmail, isEmailEnabled, passwordResetEmail, sendEmail } from "./email";
import { getServerEnv } from "./env";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors";

/**
 * Organization membership management (users.read / users.manage).
 *
 * Security rules:
 * - Every query is scoped to ctx.organizationId; a user outside the org is a 404.
 * - An organization always keeps at least one ORG_ADMIN.
 * - Credentials are only touched for users whose *only* membership is this
 *   organization (and who are not platform super admins, unless the actor is).
 *   Otherwise an admin of org A could take over an account that also has
 *   access to org B.
 * - Temporary passwords are returned once to the caller and never logged or audited.
 */

export const AddMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().min(1).max(200),
  role: z.enum(ORG_ROLES)
});
export const ChangeRoleSchema = z.object({ role: z.enum(ORG_ROLES) });

type Meta = { ipAddress: string | null; userAgent: string | null };

export interface MemberDto {
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  memberSince: string;
  lastSignInAt: string | null;
  isSuperAdmin: boolean;
}

/** 20 chars from an unambiguous alphabet (~100 bits), shown once to the admin. */
export function generateTemporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export async function listMembers(organizationId: string): Promise<MemberDto[]> {
  const db = getDb();
  const lastSignIn = db
    .select({ userId: schema.sessions.userId, at: max(schema.sessions.createdAt).as("at") })
    .from(schema.sessions)
    .groupBy(schema.sessions.userId)
    .as("last_sign_in");
  const rows = await db
    .select({
      userId: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      isSuperAdmin: schema.users.isSuperAdmin,
      role: schema.memberships.role,
      memberSince: schema.memberships.createdAt,
      lastSignInAt: lastSignIn.at
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .leftJoin(lastSignIn, eq(lastSignIn.userId, schema.users.id))
    .where(eq(schema.memberships.organizationId, organizationId))
    .orderBy(asc(schema.users.name));
  return rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    email: r.email,
    role: r.role as OrgRole,
    memberSince: r.memberSince.toISOString(),
    lastSignInAt: r.lastSignInAt ? new Date(r.lastSignInAt as unknown as string).toISOString() : null,
    isSuperAdmin: r.isSuperAdmin
  }));
}


const INVITE_LINK_SECONDS = 72 * 3600;
const ADMIN_RESET_LINK_SECONDS = 24 * 3600;

/**
 * One-time "set your password" link using Better Auth's own reset-token store,
 * so /reset-password (Better Auth's resetPassword) consumes it exactly like a
 * self-service reset. The token is never logged or stored in audit metadata.
 */
async function createPasswordLink(userId: string, seconds: number): Promise<string> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = Buffer.from(bytes).toString("base64url");
  const ctx = await getAuth().$context;
  await ctx.internalAdapter.createVerificationValue({
    identifier: `reset-password:${token}`,
    value: userId,
    expiresAt: new Date(Date.now() + seconds * 1000)
  });
  return `${new URL(getServerEnv().AUTH_URL).origin}/reset-password?token=${encodeURIComponent(token)}`;
}

async function orgName(organizationId: string) {
  const [o] = await getDb().select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, organizationId));
  return o?.name ?? "your organization";
}

export interface AddMemberResult {
  userId: string;
  /** Only when email is not configured or delivery failed; shown once to the admin. */
  temporaryPassword: string | null;
  /** True when an invitation / access email was sent. */
  emailed: boolean;
}

export async function addMember(ctx: TenantContext, input: z.infer<typeof AddMemberSchema>, meta: Meta) {
  const db = getDb();
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(schema.users).where(eq(schema.users.email, input.email)).limit(1);
    if (existing) {
      const [already] = await tx
        .select({ id: schema.memberships.id })
        .from(schema.memberships)
        .where(and(eq(schema.memberships.userId, existing.id), eq(schema.memberships.organizationId, ctx.organizationId)));
      if (already) throw new ConflictError("This person is already a member");
      // Existing account (e.g. member of another organization): grant access only;
      // their name and password are never changed by this organization.
      await tx.insert(schema.memberships).values({ userId: existing.id, organizationId: ctx.organizationId, role: input.role });
      return { userId: existing.id, created: false };
    }
    const [user] = await tx
      .insert(schema.users)
      .values({ email: input.email, name: input.name, emailVerified: false })
      .returning({ id: schema.users.id });
    await tx.insert(schema.accounts).values({ userId: user!.id, accountId: user!.id, providerId: "credential", password: passwordHash });
    await tx.insert(schema.memberships).values({ userId: user!.id, organizationId: ctx.organizationId, role: input.role });
    return { userId: user!.id, created: true };
  });

  await writeAudit({
    action: "member.added",
    actorUserId: ctx.userId,
    organizationId: ctx.organizationId,
    targetType: "user",
    targetId: result.userId,
    metadata: { role: input.role, newAccount: result.created },
    ...meta
  });

  if (isEmailEnabled()) {
    try {
      const org = await orgName(ctx.organizationId);
      if (result.created) {
        const url = await createPasswordLink(result.userId, INVITE_LINK_SECONDS);
        await sendEmail(inviteEmail(input.email, input.name, org, url, INVITE_LINK_SECONDS / 3600));
      } else {
        await sendEmail(accessGrantedEmail(input.email, input.name, org, `${new URL(getServerEnv().AUTH_URL).origin}/login`));
      }
      // The random initial password was never shown to anyone; the invite link is the only way in.
      return { userId: result.userId, temporaryPassword: null, emailed: true } satisfies AddMemberResult;
    } catch {
      // Delivery failed (already logged): fall back to the one-time temporary password.
    }
  }
  return { userId: result.userId, temporaryPassword: result.created ? temporaryPassword : null, emailed: false } satisfies AddMemberResult;
}

async function lockMembership(tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0], organizationId: string, userId: string) {
  const [m] = await tx
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.organizationId, organizationId), eq(schema.memberships.userId, userId)))
    .for("update");
  if (!m) throw new NotFoundError("Member not found");
  return m;
}

async function assertAnotherAdmin(tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0], organizationId: string, userId: string) {
  // Lock the org's admin rows so two concurrent demotions can't both pass.
  const admins = await tx
    .select({ userId: schema.memberships.userId })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.organizationId, organizationId), eq(schema.memberships.role, "ORG_ADMIN"), ne(schema.memberships.userId, userId)))
    .for("update");
  if (admins.length === 0) throw new ConflictError("An organization must keep at least one Org Admin");
}

export async function changeRole(ctx: TenantContext, userId: string, role: OrgRole, meta: Meta) {
  const previous = await getDb().transaction(async (tx) => {
    const m = await lockMembership(tx, ctx.organizationId, userId);
    if (m.role === role) return m.role;
    if (m.role === "ORG_ADMIN" && role !== "ORG_ADMIN") await assertAnotherAdmin(tx, ctx.organizationId, userId);
    await tx.update(schema.memberships).set({ role, updatedAt: new Date() }).where(eq(schema.memberships.id, m.id));
    return m.role;
  });
  if (previous !== role) {
    await writeAudit({ action: "member.role_changed", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "user", targetId: userId, metadata: { from: previous, to: role }, ...meta });
  }
}

async function revokeSessions(userId: string) {
  await getDb().delete(schema.sessions).where(eq(schema.sessions.userId, userId));
}

export async function removeMember(ctx: TenantContext, userId: string, meta: Meta) {
  await getDb().transaction(async (tx) => {
    const m = await lockMembership(tx, ctx.organizationId, userId);
    if (m.role === "ORG_ADMIN") await assertAnotherAdmin(tx, ctx.organizationId, userId);
    await tx.delete(schema.memberships).where(eq(schema.memberships.id, m.id));
  });
  // End their sessions so access stops immediately (live streams also re-check membership).
  await revokeSessions(userId);
  await writeAudit({ action: "member.removed", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "user", targetId: userId, ...meta });
}

export async function resetMemberPassword(ctx: TenantContext, userId: string, meta: Meta) {
  const db = getDb();
  const [target] = await db
    .select({ id: schema.users.id, isSuperAdmin: schema.users.isSuperAdmin })
    .from(schema.users)
    .innerJoin(schema.memberships, and(eq(schema.memberships.userId, schema.users.id), eq(schema.memberships.organizationId, ctx.organizationId)))
    .where(eq(schema.users.id, userId));
  if (!target) throw new NotFoundError("Member not found");
  if (target.isSuperAdmin && !ctx.isSuperAdmin) throw new ForbiddenError("Only a platform admin can reset this account");
  const [others] = await db
    .select({ n: count() })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.userId, userId), ne(schema.memberships.organizationId, ctx.organizationId)));
  if ((others?.n ?? 0) > 0 && !ctx.isSuperAdmin) {
    throw new ForbiddenError("This account also belongs to another organization; ask the person to change their own password");
  }

  const temporaryPassword = generateTemporaryPassword();
  const hash = await hashPassword(temporaryPassword);
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.accounts)
      .set({ password: hash, updatedAt: new Date() })
      .where(and(eq(schema.accounts.userId, userId), eq(schema.accounts.providerId, "credential")))
      .returning({ id: schema.accounts.id });
    if (updated.length === 0) {
      await tx.insert(schema.accounts).values({ userId, accountId: userId, providerId: "credential", password: hash });
    }
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
  });
  await writeAudit({ action: "member.password_reset", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "user", targetId: userId, ...meta });

  if (isEmailEnabled()) {
    try {
      const [u] = await db.select({ email: schema.users.email, name: schema.users.name }).from(schema.users).where(eq(schema.users.id, userId));
      const url = await createPasswordLink(userId, ADMIN_RESET_LINK_SECONDS);
      await sendEmail(passwordResetEmail(u!.email, u!.name, url, ADMIN_RESET_LINK_SECONDS / 60));
      // The old password was already replaced by an unknown random one above.
      return { temporaryPassword: null, emailed: true };
    } catch {
      // fall back to showing the temporary password once
    }
  }
  return { temporaryPassword, emailed: false };
}
