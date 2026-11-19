import type { TenantContext } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { and, eq, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "./audit";
import { NotFoundError } from "./errors";
import { likePattern, PAGE_SIZES } from "./fleet-list";

/**
 * Drivers and the vehicle each one drives now. One driver per vehicle at a time:
 * assigning a vehicle that already has a driver moves that vehicle to the new driver.
 * Every query is scoped to ctx.organizationId; foreign ids behave like missing ones.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === "" ? null : s))
    .nullable()
    .optional();

export const DriverInputSchema = z.object({
  name: z.string().trim().min(1, "Enter the driver's name").max(120),
  phone: optionalText(40),
  email: z
    .string()
    .trim()
    .max(200)
    .transform((s) => (s === "" ? null : s))
    .pipe(z.string().email("Enter a valid email").nullable())
    .nullable()
    .optional(),
  licenseNumber: optionalText(60),
  licenseExpiresOn: z
    .string()
    .trim()
    .transform((s) => (s === "" ? null : s))
    .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2027-05-31").nullable())
    .nullable()
    .optional(),
  vehicleId: z
    .string()
    .transform((s) => (s === "" ? null : s))
    .pipe(z.string().uuid().nullable())
    .nullable()
    .optional(),
  status: z.enum(["active", "inactive"]).optional(),
  notes: optionalText(2000)
});
export const DriverPatchSchema = DriverInputSchema.partial();
export type DriverInput = z.infer<typeof DriverInputSchema>;

export const DRIVER_FILTERS = ["all", "driving", "assigned", "unassigned", "license", "inactive"] as const;
export const DriverListQuery = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((n) => (PAGE_SIZES as readonly number[]).includes(n))
    .default(25),
  search: z.string().trim().max(100).default(""),
  sort: z.enum(["name", "vehicle", "license", "updated"]).default("name"),
  direction: z.enum(["asc", "desc"]).default("asc"),
  state: z.enum(DRIVER_FILTERS).default("all")
});
export type DriverListQuery = z.infer<typeof DriverListQuery>;

export interface DriverRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  licenseNumber: string | null;
  licenseExpiresOn: string | null;
  status: "active" | "inactive";
  notes: string | null;
  assignedAt: string | null;
  vehicle: { id: string; name: string; type: string; licensePlate: string | null; deviceId: string | null; moving: boolean; speedKph: number | null; lastSeenAt: string | null } | null;
}

/** Licence expiring within 30 days (or already expired). */
const licenseSoon = sql`(d.license_expires_on is not null and d.license_expires_on <= (now() at time zone 'utc')::date + 30)`;

export async function listDriversPage(organizationId: string, q: DriverListQuery) {
  const db = getDb();
  const search = q.search
    ? sql` and (d.name ilike ${likePattern(q.search)} or coalesce(d.phone, '') ilike ${likePattern(q.search)} or coalesce(d.email, '') ilike ${likePattern(q.search)} or coalesce(d.license_number, '') ilike ${likePattern(q.search)} or coalesce(v.name, '') ilike ${likePattern(q.search)})`
    : sql``;
  const base = sql`
    from drivers d
    left join vehicles v on v.id = d.vehicle_id and v.organization_id = d.organization_id
    left join device_assignments a on a.vehicle_id = v.id and a.unassigned_at is null and a.organization_id = d.organization_id
    left join current_locations cl on cl.device_id = a.device_id
    where d.organization_id = ${organizationId}${search}`;
  const filters: Record<(typeof DRIVER_FILTERS)[number], SQL> = {
    all: sql`true`,
    driving: sql`d.status = 'active' and coalesce(cl.speed_kph, 0) >= 5 and cl.recorded_at > now() - interval '10 minutes'`,
    assigned: sql`d.status = 'active' and d.vehicle_id is not null`,
    unassigned: sql`d.status = 'active' and d.vehicle_id is null`,
    license: licenseSoon,
    inactive: sql`d.status = 'inactive'`
  };
  const dir = q.direction === "desc" ? sql`desc` : sql`asc`;
  const order = {
    name: sql`lower(d.name) ${dir}`,
    vehicle: sql`lower(v.name) ${dir} nulls last`,
    license: sql`d.license_expires_on ${dir} nulls last`,
    updated: sql`d.updated_at ${dir}`
  }[q.sort];
  const [rows, counts] = await Promise.all([
    db.execute<Record<string, unknown>>(sql`
      select d.*, v.name as v_name, v.type as v_type, v.license_plate as v_plate, a.device_id as v_device,
             cl.speed_kph as v_speed, cl.recorded_at as v_seen, count(*) over() as total
      ${base} and ${filters[q.state]}
      order by d.status asc, ${order}, d.id
      limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`),
    db.execute<Record<string, number>>(sql`
      select count(*)::int as all,
        count(*) filter (where ${filters.driving})::int as driving,
        count(*) filter (where ${filters.assigned})::int as assigned,
        count(*) filter (where ${filters.unassigned})::int as unassigned,
        count(*) filter (where ${filters.license})::int as license,
        count(*) filter (where ${filters.inactive})::int as inactive
      ${base}`)
  ]);
  const now = Date.now();
  return {
    items: rows.map((r): DriverRow => {
      const seen = r.v_seen ? new Date(r.v_seen as string) : null;
      return {
        id: String(r.id),
        name: String(r.name),
        phone: (r.phone as string | null) ?? null,
        email: (r.email as string | null) ?? null,
        licenseNumber: (r.license_number as string | null) ?? null,
        licenseExpiresOn: r.license_expires_on ? String(r.license_expires_on).slice(0, 10) : null,
        status: r.status as "active" | "inactive",
        notes: (r.notes as string | null) ?? null,
        assignedAt: r.assigned_at ? new Date(r.assigned_at as string).toISOString() : null,
        vehicle: r.vehicle_id
          ? {
              id: String(r.vehicle_id),
              name: String(r.v_name),
              type: String(r.v_type ?? "truck"),
              licensePlate: (r.v_plate as string | null) ?? null,
              deviceId: (r.v_device as string | null) ?? null,
              speedKph: r.v_speed == null ? null : Number(r.v_speed),
              lastSeenAt: seen ? seen.toISOString() : null,
              moving: Boolean(seen && now - seen.getTime() < 10 * 60_000 && Number(r.v_speed ?? 0) >= 5)
            }
          : null
      };
    }),
    total: Number(rows[0]?.total ?? 0),
    page: q.page,
    pageSize: q.pageSize,
    counts: (counts[0] ?? { all: 0, driving: 0, assigned: 0, unassigned: 0, license: 0, inactive: 0 }) as Record<(typeof DRIVER_FILTERS)[number], number>
  };
}

/** The active driver of each vehicle (for lists, the map and vehicle details). */
export async function driversByVehicle(organizationId: string): Promise<Map<string, { id: string; name: string; phone: string | null }>> {
  const rows = await getDb()
    .select({ id: schema.drivers.id, name: schema.drivers.name, phone: schema.drivers.phone, vehicleId: schema.drivers.vehicleId })
    .from(schema.drivers)
    .where(and(eq(schema.drivers.organizationId, organizationId), eq(schema.drivers.status, "active")));
  const m = new Map<string, { id: string; name: string; phone: string | null }>();
  for (const r of rows) if (r.vehicleId) m.set(r.vehicleId, { id: r.id, name: r.name, phone: r.phone });
  return m;
}

type Meta = { ipAddress: string | null; userAgent: string | null };
type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** Checks the vehicle belongs to the organization and frees it from any other driver. */
async function takeVehicle(tx: Tx, organizationId: string, vehicleId: string, driverId: string | null) {
  const [v] = await tx
    .select({ id: schema.vehicles.id })
    .from(schema.vehicles)
    .where(and(eq(schema.vehicles.id, vehicleId), eq(schema.vehicles.organizationId, organizationId)));
  if (!v) throw new NotFoundError("Vehicle not found");
  await tx
    .update(schema.drivers)
    .set({ vehicleId: null, assignedAt: null, updatedAt: new Date() })
    .where(and(eq(schema.drivers.organizationId, organizationId), eq(schema.drivers.vehicleId, vehicleId), ...(driverId ? [ne(schema.drivers.id, driverId)] : [])));
}

export async function createDriver(ctx: TenantContext, input: DriverInput, meta: Meta) {
  const d = await getDb().transaction(async (tx) => {
    if (input.vehicleId) await takeVehicle(tx, ctx.organizationId, input.vehicleId, null);
    const [row] = await tx
      .insert(schema.drivers)
      .values({
        organizationId: ctx.organizationId,
        name: input.name,
        phone: input.phone ?? null,
        email: input.email ?? null,
        licenseNumber: input.licenseNumber ?? null,
        licenseExpiresOn: input.licenseExpiresOn ?? null,
        vehicleId: input.vehicleId ?? null,
        assignedAt: input.vehicleId ? new Date() : null,
        status: input.status ?? "active",
        notes: input.notes ?? null
      })
      .returning();
    return row!;
  });
  await writeAudit({ action: "driver.created", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "driver", targetId: d.id, metadata: { name: d.name }, ...meta });
  return d;
}

export async function updateDriver(ctx: TenantContext, id: string, patch: Partial<DriverInput>, meta: Meta) {
  const d = await getDb().transaction(async (tx) => {
    const [cur] = await tx
      .select()
      .from(schema.drivers)
      .where(and(eq(schema.drivers.id, id), eq(schema.drivers.organizationId, ctx.organizationId)))
      .for("update");
    if (!cur) throw new NotFoundError("Driver not found");
    const vehicleChanged = patch.vehicleId !== undefined && patch.vehicleId !== cur.vehicleId;
    if (vehicleChanged && patch.vehicleId) await takeVehicle(tx, ctx.organizationId, patch.vehicleId, id);
    // An inactive driver drives nothing.
    const deactivating = patch.status === "inactive";
    const [row] = await tx
      .update(schema.drivers)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
        ...(patch.email !== undefined ? { email: patch.email } : {}),
        ...(patch.licenseNumber !== undefined ? { licenseNumber: patch.licenseNumber } : {}),
        ...(patch.licenseExpiresOn !== undefined ? { licenseExpiresOn: patch.licenseExpiresOn } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(deactivating ? { vehicleId: null, assignedAt: null } : vehicleChanged ? { vehicleId: patch.vehicleId ?? null, assignedAt: patch.vehicleId ? new Date() : null } : {}),
        updatedAt: new Date()
      })
      .where(eq(schema.drivers.id, id))
      .returning();
    return row!;
  });
  await writeAudit({ action: "driver.updated", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "driver", targetId: id, metadata: { fields: Object.keys(patch) }, ...meta });
  return d;
}

export async function deleteDriver(ctx: TenantContext, id: string, meta: Meta) {
  const [d] = await getDb()
    .delete(schema.drivers)
    .where(and(eq(schema.drivers.id, id), eq(schema.drivers.organizationId, ctx.organizationId)))
    .returning({ id: schema.drivers.id, name: schema.drivers.name });
  if (!d) throw new NotFoundError("Driver not found");
  await writeAudit({ action: "driver.deleted", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "driver", targetId: id, metadata: { name: d.name }, ...meta });
}

