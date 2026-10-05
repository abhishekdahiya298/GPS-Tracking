import type { TenantContext } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "./audit";
import { ConflictError, NotFoundError, ValidationError } from "./errors";

/**
 * Vehicle groups: named sets of vehicles within one organization. Every query is scoped to
 * ctx.organizationId; vehicle ids supplied by the client are checked against that
 * organization before they are stored.
 */
type Meta = { ipAddress: string | null; userAgent: string | null };
export const MAX_GROUPS = 200;

const Name = z.string().trim().min(1, "Give the group a name").max(60);
const VehicleIds = z.array(z.string().uuid()).max(5000);
export const GroupInputSchema = z.object({ name: Name, vehicleIds: VehicleIds.optional() });
export const GroupPatchSchema = z
  .object({ name: Name, vehicleIds: VehicleIds })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export interface GroupDto {
  id: string;
  name: string;
  vehicleIds: string[];
}

export async function listGroups(organizationId: string): Promise<GroupDto[]> {
  const db = getDb();
  const g = schema.vehicleGroups;
  const m = schema.vehicleGroupMembers;
  const [groups, members] = await Promise.all([
    db.select({ id: g.id, name: g.name }).from(g).where(eq(g.organizationId, organizationId)).orderBy(asc(sql`lower(${g.name})`)),
    db.select({ groupId: m.groupId, vehicleId: m.vehicleId }).from(m).where(eq(m.organizationId, organizationId))
  ]);
  const by = new Map<string, string[]>();
  for (const x of members) by.set(x.groupId, [...(by.get(x.groupId) ?? []), x.vehicleId]);
  return groups.map((x) => ({ ...x, vehicleIds: by.get(x.id) ?? [] }));
}

/** Only ids of vehicles that belong to the organization; anything else is rejected, not ignored. */
async function ownVehicleIds(organizationId: string, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows = await getDb().select({ id: schema.vehicles.id }).from(schema.vehicles).where(and(eq(schema.vehicles.organizationId, organizationId), inArray(schema.vehicles.id, unique)));
  if (rows.length !== unique.length) throw new ValidationError("One or more vehicles were not found");
  return unique;
}

const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
};

export async function createGroup(ctx: TenantContext, input: z.infer<typeof GroupInputSchema>, meta: Meta): Promise<GroupDto> {
  const db = getDb();
  const vehicleIds = await ownVehicleIds(ctx.organizationId, input.vehicleIds ?? []);
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.vehicleGroups).where(eq(schema.vehicleGroups.organizationId, ctx.organizationId))) as [{ n: number }];
  if (n >= MAX_GROUPS) throw new ValidationError(`An organization can have at most ${MAX_GROUPS} groups`);
  let id: string;
  try {
    id = await db.transaction(async (tx) => {
      const [g] = await tx.insert(schema.vehicleGroups).values({ organizationId: ctx.organizationId, name: input.name }).returning({ id: schema.vehicleGroups.id });
      if (vehicleIds.length) await tx.insert(schema.vehicleGroupMembers).values(vehicleIds.map((vehicleId) => ({ groupId: g!.id, vehicleId, organizationId: ctx.organizationId })));
      return g!.id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError("A group with this name already exists");
    throw err;
  }
  await writeAudit({ action: "vehicle_group.created", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "vehicle_group", targetId: id, metadata: { name: input.name, vehicles: vehicleIds.length }, ...meta });
  return { id, name: input.name, vehicleIds };
}

export async function updateGroup(ctx: TenantContext, id: string, patch: z.infer<typeof GroupPatchSchema>, meta: Meta): Promise<void> {
  const db = getDb();
  const g = schema.vehicleGroups;
  const m = schema.vehicleGroupMembers;
  const vehicleIds = patch.vehicleIds ? await ownVehicleIds(ctx.organizationId, patch.vehicleIds) : null;
  try {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(g)
        .set({ ...(patch.name !== undefined ? { name: patch.name } : {}), updatedAt: new Date() })
        .where(and(eq(g.id, id), eq(g.organizationId, ctx.organizationId)))
        .returning({ id: g.id });
      if (!row) throw new NotFoundError("Group not found");
      if (vehicleIds) {
        await tx.delete(m).where(and(eq(m.groupId, id), eq(m.organizationId, ctx.organizationId)));
        if (vehicleIds.length) await tx.insert(m).values(vehicleIds.map((vehicleId) => ({ groupId: id, vehicleId, organizationId: ctx.organizationId })));
      }
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError("A group with this name already exists");
    throw err;
  }
  await writeAudit({
    action: "vehicle_group.updated",
    actorUserId: ctx.userId,
    organizationId: ctx.organizationId,
    targetType: "vehicle_group",
    targetId: id,
    metadata: { ...(patch.name !== undefined ? { name: patch.name } : {}), ...(vehicleIds ? { vehicles: vehicleIds.length } : {}) },
    ...meta
  });
}

export async function deleteGroup(ctx: TenantContext, id: string, meta: Meta): Promise<void> {
  const g = schema.vehicleGroups;
  const [row] = await getDb().delete(g).where(and(eq(g.id, id), eq(g.organizationId, ctx.organizationId))).returning({ name: g.name });
  if (!row) throw new NotFoundError("Group not found");
  await writeAudit({ action: "vehicle_group.deleted", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "vehicle_group", targetId: id, metadata: { name: row.name }, ...meta });
}

/** Vehicle ids in a group of this organization, or null when the group doesn't exist there. */
export async function groupVehicleIds(organizationId: string, groupId: string): Promise<string[] | null> {
  const db = getDb();
  const [g] = await db.select({ id: schema.vehicleGroups.id }).from(schema.vehicleGroups).where(and(eq(schema.vehicleGroups.id, groupId), eq(schema.vehicleGroups.organizationId, organizationId)));
  if (!g) return null;
  const m = schema.vehicleGroupMembers;
  return (await db.select({ vehicleId: m.vehicleId }).from(m).where(and(eq(m.groupId, groupId), eq(m.organizationId, organizationId)))).map((r) => r.vehicleId);
}
