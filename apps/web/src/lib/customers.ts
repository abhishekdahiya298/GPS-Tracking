import { isValidImei } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "./audit";
import { AppError, ConflictError, NotFoundError } from "./errors";
import { logger } from "./logger";
import { addMember } from "./team";
import { getTraccarAdmin } from "./traccar";

/**
 * Platform (super admin) operations: create customer organizations, register
 * devices in Traccar + RIO, and "view as" a customer. Callers must have
 * verified isSuperAdmin; nothing here is reachable by tenant roles.
 */

type Meta = { ipAddress: string | null; userAgent: string | null };

export const CreateCustomerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/, "lowercase letters, digits and dashes"),
  admin: z.object({ email: z.string().trim().toLowerCase().email().max(254), name: z.string().trim().min(1).max(200) })
});

export const RegisterDeviceSchema = z.object({
  imei: z
    .string()
    .trim()
    .refine(isValidImei, "IMEI must be 15 digits with a valid check digit"),
  model: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(80).optional()
});

export interface CustomerDto {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  devices: number;
  members: number;
}

export async function listCustomers(): Promise<CustomerDto[]> {
  const rows = await getDb().execute<{ id: string; name: string; slug: string; created_at: Date; devices: number; members: number }>(sql`
    select o.id, o.name, o.slug, o.created_at,
      (select count(*)::int from gps_devices d where d.organization_id = o.id) as devices,
      (select count(*)::int from memberships m where m.organization_id = o.id) as members
    from organizations o order by o.name`);
  return rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, createdAt: new Date(r.created_at).toISOString(), devices: r.devices, members: r.members }));
}

export async function createCustomer(actorUserId: string, input: z.infer<typeof CreateCustomerSchema>, meta: Meta) {
  const db = getDb();
  let orgId: string;
  try {
    orgId = await db.transaction(async (tx) => {
      const [org] = await tx.insert(schema.organizations).values({ name: input.name, slug: input.slug }).returning({ id: schema.organizations.id });
      await tx.insert(schema.gpsProviders).values({ organizationId: org!.id, kind: "traccar", name: "Traccar", apiBaseUrl: "http://traccar:8082" });
      return org!.id;
    });
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    if (e?.code === "23505" || e?.cause?.code === "23505") throw new ConflictError("That short name (slug) is already taken");
    throw err;
  }
  await writeAudit({ action: "customer.created", actorUserId, organizationId: orgId, targetType: "organization", targetId: orgId, metadata: { slug: input.slug }, ...meta });
  // First Org Admin: invitation email (or a one-time temporary password if email is unavailable).
  const admin = await addMember({ userId: actorUserId, organizationId: orgId, role: null, isSuperAdmin: true }, { email: input.admin.email, name: input.admin.name, role: "ORG_ADMIN" }, meta);
  return { organizationId: orgId, admin };
}

export async function registerDevice(actorUserId: string, organizationId: string, input: z.infer<typeof RegisterDeviceSchema>, meta: Meta) {
  const db = getDb();
  const [provider] = await db.select({ id: schema.gpsProviders.id }).from(schema.gpsProviders).where(eq(schema.gpsProviders.organizationId, organizationId)).limit(1);
  const [org] = await db.select({ id: schema.organizations.id, slug: schema.organizations.slug }).from(schema.organizations).where(eq(schema.organizations.id, organizationId));
  if (!org) throw new NotFoundError("Customer not found");
  const [existing] = await db.select({ organizationId: schema.gpsDevices.organizationId }).from(schema.gpsDevices).where(eq(schema.gpsDevices.imei, input.imei));
  if (existing) throw new ConflictError(existing.organizationId === organizationId ? "This device is already registered for this customer" : "This IMEI is already registered to another customer");

  // Traccar first: a device RIO knows about but Traccar rejects would silently never report.
  let traccar;
  try {
    traccar = await getTraccarAdmin().ensureDevice(input.name ?? `${input.model}-${input.imei.slice(-4)}`, input.imei);
  } catch (err) {
    logger.error("customers.traccar_register_failed", { organizationId }, err);
    throw new AppError("TRACCAR_UNAVAILABLE", 502, "Could not register the device in Traccar; nothing was saved. Try again.");
  }

  const providerId =
    provider?.id ??
    (await db.insert(schema.gpsProviders).values({ organizationId, kind: "traccar", name: "Traccar", apiBaseUrl: "http://traccar:8082" }).returning({ id: schema.gpsProviders.id }))[0]!.id;
  let dev: { id: string } | undefined;
  try {
    [dev] = await db
      .insert(schema.gpsDevices)
      .values({ organizationId, providerId, externalDeviceId: input.imei, imei: input.imei, model: input.model })
      .returning({ id: schema.gpsDevices.id });
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    if (e?.code === "23505" || e?.cause?.code === "23505") throw new ConflictError("This IMEI was just registered by another request");
    throw err;
  }
  await writeAudit({
    action: "device.registered",
    actorUserId,
    organizationId,
    targetType: "device",
    targetId: dev!.id,
    metadata: { model: input.model, imeiLast4: input.imei.slice(-4), traccarCreated: traccar.created },
    ...meta
  });
  return { deviceId: dev!.id, traccarCreated: traccar.created };
}

/** Super admin "view as": sets the session's active organization (null = back to own). */
export async function setViewAs(actorUserId: string, sessionId: string, organizationId: string | null, meta: Meta) {
  const db = getDb();
  if (organizationId) {
    const [org] = await db.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.id, organizationId));
    if (!org) throw new NotFoundError("Customer not found");
  }
  await db.update(schema.sessions).set({ activeOrganizationId: organizationId }).where(eq(schema.sessions.id, sessionId));
  await writeAudit({ action: organizationId ? "admin.view_as_started" : "admin.view_as_ended", actorUserId, organizationId, targetType: "organization", targetId: organizationId, ...meta });
}
