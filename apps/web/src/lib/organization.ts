import { UNIT_SYSTEMS, type TenantContext } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "./audit";
import { NotFoundError } from "./errors";

type Meta = { ipAddress: string | null; userAgent: string | null };

export const OrgSettingsPatchSchema = z
  .object({ unitSystem: z.enum(UNIT_SYSTEMS) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export async function getOrgSettings(organizationId: string) {
  const [o] = await getDb()
    .select({ name: schema.organizations.name, slug: schema.organizations.slug, unitSystem: schema.organizations.unitSystem })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId));
  if (!o) throw new NotFoundError("Organization not found");
  return o;
}

/** Tenant is always ctx.organizationId (never from the request). */
export async function updateOrgSettings(ctx: TenantContext, patch: z.infer<typeof OrgSettingsPatchSchema>, meta: Meta) {
  const before = await getOrgSettings(ctx.organizationId);
  await getDb().update(schema.organizations).set({ ...patch, updatedAt: new Date() }).where(eq(schema.organizations.id, ctx.organizationId));
  await writeAudit({
    action: "organization.settings_updated",
    actorUserId: ctx.userId,
    organizationId: ctx.organizationId,
    targetType: "organization",
    targetId: ctx.organizationId,
    metadata: { unitSystem: { from: before.unitSystem, to: patch.unitSystem ?? before.unitSystem } },
    ...meta
  });
}
