import { getDb, schema } from "@rio-gps/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "./audit";
import { ConflictError, NotFoundError } from "./errors";

/**
 * Customer lifecycle (platform admins only). Suspending or archiving never deletes data:
 * every row stays, so Restore puts the customer back exactly as it was.
 *
 *            | sign in | alerts/emails/reports | public links | tracker positions stored
 * active     |   yes   |          yes          |     yes      |           yes
 * suspended  |   no    |          no           |     no       |           yes
 * archived   |   no    |          no           |     no       |           no
 */
export const ORGANIZATION_STATUSES = ["active", "suspended", "archived"] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export const SetCustomerStatusSchema = z
  .object({
    status: z.enum(ORGANIZATION_STATUSES),
    reason: z.string().trim().max(500).optional()
  })
  .refine((v) => v.status === "active" || (v.reason?.length ?? 0) >= 3, { message: "Give a short reason", path: ["reason"] });

type Meta = { ipAddress: string | null; userAgent: string | null };

// Positions arrive every few seconds per tracker, so the ingest path reads the status from a
// short per-process cache instead of joining organizations on every write. A change made here
// clears this process's entry at once; other processes pick it up within the TTL.
const TTL_MS = 30_000;
const g = globalThis as unknown as { __rioOrgStatus?: Map<string, { status: OrganizationStatus; at: number }> };
const cacheMap = () => (g.__rioOrgStatus ??= new Map());

export async function getOrganizationStatus(organizationId: string, now = Date.now()): Promise<OrganizationStatus | null> {
  const hit = cacheMap().get(organizationId);
  if (hit && now - hit.at < TTL_MS) return hit.status;
  const [row] = await getDb().select({ status: schema.organizations.status }).from(schema.organizations).where(eq(schema.organizations.id, organizationId));
  if (!row) return null;
  cacheMap().set(organizationId, { status: row.status, at: now });
  return row.status;
}

/** Alerts, emails, push, scheduled reports and public links only run for active customers. */
export async function isOrganizationActive(organizationId: string): Promise<boolean> {
  return (await getOrganizationStatus(organizationId)) === "active";
}

export function clearOrganizationStatusCache(organizationId?: string) {
  if (organizationId) cacheMap().delete(organizationId);
  else cacheMap().clear();
}

const AUDIT_ACTION: Record<OrganizationStatus, string> = { active: "customer.restored", suspended: "customer.suspended", archived: "customer.archived" };

export async function setCustomerStatus(actorUserId: string, organizationId: string, input: z.infer<typeof SetCustomerStatusSchema>, meta: Meta, now = new Date()) {
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const [org] = await tx
      .select({ id: schema.organizations.id, status: schema.organizations.status })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId))
      .for("update");
    if (!org) throw new NotFoundError("Customer not found");
    if (org.status === input.status) throw new ConflictError(`This customer is already ${input.status}`);
    await tx
      .update(schema.organizations)
      .set({ status: input.status, statusReason: input.status === "active" ? null : (input.reason ?? null), statusChangedAt: now, statusChangedBy: actorUserId, updatedAt: now })
      .where(eq(schema.organizations.id, organizationId));
    return { from: org.status };
  });
  clearOrganizationStatusCache(organizationId);
  await writeAudit({
    action: AUDIT_ACTION[input.status],
    actorUserId,
    organizationId,
    targetType: "organization",
    targetId: organizationId,
    metadata: { from: result.from, to: input.status, ...(input.reason ? { reason: input.reason } : {}) },
    ...meta
  });
  return { from: result.from, to: input.status };
}
