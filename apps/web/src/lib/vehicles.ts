import type { TenantContext } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "./audit";
import { ConflictError, NotFoundError, ValidationError } from "./errors";

/**
 * Vehicles and device assignments. Every query is filtered by ctx.organizationId;
 * ids from the client are only ever matched *within* that organization, so a
 * foreign id behaves exactly like a missing one (404).
 */

export const VehicleInputSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(120),
  licensePlate: z
    .string()
    .trim()
    .max(32)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  status: z.enum(["active", "inactive", "maintenance"]).optional()
});
export const VehiclePatchSchema = VehicleInputSchema.partial().refine((v) => Object.keys(v).length > 0, "Nothing to update");

export function parseOrThrow<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new ValidationError(r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return r.data;
}

export interface VehicleDto {
  id: string;
  name: string;
  licensePlate: string | null;
  status: string;
  devices: { id: string; model: string | null; name: string | null; assignedAt: string }[];
}

export async function listVehicles(organizationId: string): Promise<VehicleDto[]> {
  const db = getDb();
  const vs = await db
    .select()
    .from(schema.vehicles)
    .where(eq(schema.vehicles.organizationId, organizationId))
    .orderBy(asc(schema.vehicles.name));
  const assigned = await db
    .select({
      vehicleId: schema.deviceAssignments.vehicleId,
      deviceId: schema.gpsDevices.id,
      model: schema.gpsDevices.model,
      name: schema.gpsDevices.name,
      assignedAt: schema.deviceAssignments.assignedAt
    })
    .from(schema.deviceAssignments)
    .innerJoin(
      schema.gpsDevices,
      and(eq(schema.gpsDevices.id, schema.deviceAssignments.deviceId), eq(schema.gpsDevices.organizationId, organizationId))
    )
    .where(and(eq(schema.deviceAssignments.organizationId, organizationId), isNull(schema.deviceAssignments.unassignedAt)));
  return vs.map((v) => ({
    id: v.id,
    name: v.name,
    licensePlate: v.licensePlate,
    status: v.status,
    devices: assigned
      .filter((a) => a.vehicleId === v.id)
      .map((a) => ({ id: a.deviceId, model: a.model, name: a.name, assignedAt: a.assignedAt.toISOString() }))
  }));
}

type Meta = { ipAddress: string | null; userAgent: string | null };

export async function createVehicle(ctx: TenantContext, input: z.infer<typeof VehicleInputSchema>, meta: Meta) {
  const [v] = await getDb()
    .insert(schema.vehicles)
    .values({ organizationId: ctx.organizationId, name: input.name, licensePlate: input.licensePlate ?? null, status: input.status ?? "active" })
    .returning();
  await writeAudit({ action: "vehicle.created", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "vehicle", targetId: v!.id, metadata: { name: v!.name }, ...meta });
  return v!;
}

export async function updateVehicle(ctx: TenantContext, id: string, patch: z.infer<typeof VehiclePatchSchema>, meta: Meta) {
  const [v] = await getDb()
    .update(schema.vehicles)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.licensePlate !== undefined ? { licensePlate: patch.licensePlate } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      updatedAt: new Date()
    })
    .where(and(eq(schema.vehicles.id, id), eq(schema.vehicles.organizationId, ctx.organizationId)))
    .returning();
  if (!v) throw new NotFoundError("Vehicle not found");
  await writeAudit({ action: "vehicle.updated", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "vehicle", targetId: id, metadata: { fields: Object.keys(patch) }, ...meta });
  return v;
}

/**
 * Deleting is refused once a vehicle has recorded history or any assignment
 * (it would orphan the audit trail); set status "inactive" instead.
 */
export async function deleteVehicle(ctx: TenantContext, id: string, meta: Meta) {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [v] = await tx
      .select({ id: schema.vehicles.id })
      .from(schema.vehicles)
      .where(and(eq(schema.vehicles.id, id), eq(schema.vehicles.organizationId, ctx.organizationId)))
      .for("update");
    if (!v) throw new NotFoundError("Vehicle not found");
    const [a] = await tx.select({ n: count() }).from(schema.deviceAssignments).where(eq(schema.deviceAssignments.vehicleId, id));
    const [h] = await tx.select({ n: count() }).from(schema.locationHistory).where(eq(schema.locationHistory.vehicleId, id));
    if ((a?.n ?? 0) > 0 || (h?.n ?? 0) > 0) {
      throw new ConflictError("Vehicle has assignment or location history; set its status to inactive instead");
    }
    await tx.delete(schema.vehicles).where(eq(schema.vehicles.id, id));
  });
  await writeAudit({ action: "vehicle.deleted", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "vehicle", targetId: id, ...meta });
}

export interface DeviceDto {
  id: string;
  model: string | null;
  name: string | null;
  /** Only for callers with devices.manage (to tell identical trackers apart). */
  imeiLast4?: string;
  status: string;
  lastSeenAt: string | null;
  vehicle: { id: string; name: string; assignedAt: string } | null;
}

export async function listDevices(organizationId: string, opts: { includeImeiLast4?: boolean } = {}): Promise<DeviceDto[]> {
  const rows = await getDb()
    .select({
      id: schema.gpsDevices.id,
      model: schema.gpsDevices.model,
      name: schema.gpsDevices.name,
      imei: schema.gpsDevices.imei,
      status: schema.gpsDevices.status,
      lastSeenAt: schema.gpsDevices.lastSeenAt,
      vehicleId: schema.vehicles.id,
      vehicleName: schema.vehicles.name,
      assignedAt: schema.deviceAssignments.assignedAt
    })
    .from(schema.gpsDevices)
    .leftJoin(
      schema.deviceAssignments,
      and(
        eq(schema.deviceAssignments.deviceId, schema.gpsDevices.id),
        eq(schema.deviceAssignments.organizationId, organizationId),
        isNull(schema.deviceAssignments.unassignedAt)
      )
    )
    .leftJoin(schema.vehicles, and(eq(schema.vehicles.id, schema.deviceAssignments.vehicleId), eq(schema.vehicles.organizationId, organizationId)))
    .where(eq(schema.gpsDevices.organizationId, organizationId))
    .orderBy(asc(schema.gpsDevices.createdAt));
  return rows.map((r) => ({
    id: r.id,
    model: r.model,
    name: r.name,
    ...(opts.includeImeiLast4 ? { imeiLast4: r.imei.slice(-4) } : {}),
    status: r.status,
    lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
    vehicle: r.vehicleId ? { id: r.vehicleId, name: r.vehicleName!, assignedAt: r.assignedAt!.toISOString() } : null
  }));
}

function isUniqueViolation(err: unknown) {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/**
 * Moves a device onto a vehicle: closes its active assignment (if any) and
 * opens a new one, atomically. Both ids must belong to the caller's org.
 */
export async function assignDevice(ctx: TenantContext, deviceId: string, vehicleId: string, meta: Meta) {
  const db = getDb();
  let previousVehicleId: string | null = null;
  try {
    await db.transaction(async (tx) => {
      const [device] = await tx
        .select({ id: schema.gpsDevices.id })
        .from(schema.gpsDevices)
        .where(and(eq(schema.gpsDevices.id, deviceId), eq(schema.gpsDevices.organizationId, ctx.organizationId)))
        .for("update");
      if (!device) throw new NotFoundError("Device not found");
      const [vehicle] = await tx
        .select({ id: schema.vehicles.id })
        .from(schema.vehicles)
        .where(and(eq(schema.vehicles.id, vehicleId), eq(schema.vehicles.organizationId, ctx.organizationId)));
      if (!vehicle) throw new NotFoundError("Vehicle not found");

      const now = new Date();
      const closed = await tx
        .update(schema.deviceAssignments)
        .set({ unassignedAt: now })
        .where(
          and(
            eq(schema.deviceAssignments.deviceId, deviceId),
            eq(schema.deviceAssignments.organizationId, ctx.organizationId),
            isNull(schema.deviceAssignments.unassignedAt)
          )
        )
        .returning({ vehicleId: schema.deviceAssignments.vehicleId });
      previousVehicleId = closed[0]?.vehicleId ?? null;
      if (previousVehicleId === vehicleId) throw new ConflictError("Device is already assigned to this vehicle");
      await tx.insert(schema.deviceAssignments).values({ organizationId: ctx.organizationId, deviceId, vehicleId, assignedAt: now });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError("Device assignment changed concurrently; retry");
    throw err;
  }
  await writeAudit({
    action: "device.assigned",
    actorUserId: ctx.userId,
    organizationId: ctx.organizationId,
    targetType: "device",
    targetId: deviceId,
    metadata: { vehicleId, previousVehicleId },
    ...meta
  });
}

export async function unassignDevice(ctx: TenantContext, deviceId: string, meta: Meta) {
  const db = getDb();
  const [device] = await db
    .select({ id: schema.gpsDevices.id })
    .from(schema.gpsDevices)
    .where(and(eq(schema.gpsDevices.id, deviceId), eq(schema.gpsDevices.organizationId, ctx.organizationId)));
  if (!device) throw new NotFoundError("Device not found");
  const closed = await db
    .update(schema.deviceAssignments)
    .set({ unassignedAt: new Date() })
    .where(
      and(
        eq(schema.deviceAssignments.deviceId, deviceId),
        eq(schema.deviceAssignments.organizationId, ctx.organizationId),
        isNull(schema.deviceAssignments.unassignedAt)
      )
    )
    .returning({ vehicleId: schema.deviceAssignments.vehicleId });
  if (closed.length === 0) throw new ConflictError("Device is not assigned");
  await writeAudit({
    action: "device.unassigned",
    actorUserId: ctx.userId,
    organizationId: ctx.organizationId,
    targetType: "device",
    targetId: deviceId,
    metadata: { vehicleId: closed[0]!.vehicleId },
    ...meta
  });
}

export const DevicePatchSchema = z
  .object({
    name: z.string().trim().max(80).nullable().optional(),
    active: z.boolean().optional()
  })
  .refine((v) => v.name !== undefined || v.active !== undefined, "Nothing to update");

/**
 * Customer-side device management (devices.manage). Deactivating keeps the device
 * and its history; RIO simply stops storing its positions until reactivated.
 * Retired devices (platform decision) cannot be reactivated here.
 */
export async function updateDevice(ctx: TenantContext, id: string, patch: z.infer<typeof DevicePatchSchema>, meta: Meta) {
  const db = getDb();
  const [dev] = await db
    .select({ status: schema.gpsDevices.status, name: schema.gpsDevices.name })
    .from(schema.gpsDevices)
    .where(and(eq(schema.gpsDevices.id, id), eq(schema.gpsDevices.organizationId, ctx.organizationId)));
  if (!dev) throw new NotFoundError("Device not found");
  if (dev.status === "retired" && patch.active !== undefined) throw new ConflictError("This device is retired; contact support");
  const set: Partial<typeof schema.gpsDevices.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name === "" ? null : patch.name;
  if (patch.active !== undefined) set.status = patch.active ? "active" : "inactive";
  await db.update(schema.gpsDevices).set(set).where(and(eq(schema.gpsDevices.id, id), eq(schema.gpsDevices.organizationId, ctx.organizationId)));
  if (patch.name !== undefined && (set.name ?? null) !== dev.name) {
    await writeAudit({ action: "device.renamed", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "device", targetId: id, metadata: { from: dev.name, to: set.name ?? null }, ...meta });
  }
  if (patch.active !== undefined && set.status !== dev.status) {
    await writeAudit({ action: patch.active ? "device.reactivated" : "device.deactivated", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "device", targetId: id, ...meta });
  }
}
