import { UNIT_SYSTEMS } from "@rio-gps/core";
import { DEFAULT_TIME_ZONE } from "@rio-gps/core/timezones";
import { TimeZoneSchema } from "./organization";
import { isValidImei } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "./audit";
import { AppError, ConflictError, NotFoundError, ValidationError } from "./errors";
import { logger } from "./logger";
import { addMember } from "./team";
import { getTraccarAdmin } from "./traccar";
import { BULK_IMPORT_MAX } from "./imei-list";
import { assignToCustomer } from "./inventory";
import { TIME_FORMATS } from "@rio-gps/core/timezones";
import type { OrganizationStatus } from "./organization-status";

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
  admin: z.object({ email: z.string().trim().toLowerCase().email().max(254), name: z.string().trim().min(1).max(200) }),
  /** The customer's home zone (their dispatch office); users can still override it. */
  timeZone: TimeZoneSchema.default(DEFAULT_TIME_ZONE),
  unitSystem: z.enum(UNIT_SYSTEMS).default("imperial")
});

export const RegisterDeviceSchema = z.object({
  imei: z
    .string()
    .trim()
    .regex(/^\d{15}$/, "The IMEI must be exactly 15 digits"),
  /**
   * A real IMEI ends in a check digit, which catches most typing mistakes. Some trackers ship
   * with a non-standard number, so a platform admin may confirm one that fails the check.
   */
  allowUncheckedImei: z.boolean().default(false),
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
      (select count(*)::int from memberships m join users u on u.id = m.user_id where m.organization_id = o.id and not u.is_super_admin) as members
    from organizations o order by o.name`);
  return rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, createdAt: new Date(r.created_at).toISOString(), devices: r.devices, members: r.members }));
}

export async function createCustomer(actorUserId: string, input: z.infer<typeof CreateCustomerSchema>, meta: Meta) {
  const db = getDb();
  // Checked before anything is created, so a refused admin never leaves an empty customer behind.
  const [adminUser] = await db.select({ isSuperAdmin: schema.users.isSuperAdmin }).from(schema.users).where(eq(schema.users.email, input.admin.email)).limit(1);
  if (adminUser?.isSuperAdmin) throw new ValidationError("That email is a RIO GPS platform admin. Enter the customer's own administrator; you can open any customer with View as customer.");
  let orgId: string;
  try {
    orgId = await db.transaction(async (tx) => {
      const [org] = await tx.insert(schema.organizations).values({ name: input.name, slug: input.slug, timeZone: input.timeZone, unitSystem: input.unitSystem }).returning({ id: schema.organizations.id });
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
  const [org] = await db.select({ id: schema.organizations.id, slug: schema.organizations.slug, status: schema.organizations.status }).from(schema.organizations).where(eq(schema.organizations.id, organizationId));
  if (!org) throw new NotFoundError("Customer not found");
  if (org.status === "archived") throw new ConflictError("This customer is archived. Restore it before adding trackers.");
  if (!isValidImei(input.imei) && !input.allowUncheckedImei) {
    throw new ValidationError("This number does not pass the IMEI check, which usually means one digit is mistyped. Compare it with the device label.", { code: "IMEI_CHECK_DIGIT" });
  }
  const [existing] = await db.select({ id: schema.gpsDevices.id, organizationId: schema.gpsDevices.organizationId, status: schema.gpsDevices.status }).from(schema.gpsDevices).where(eq(schema.gpsDevices.imei, input.imei));
  if (existing && !existing.organizationId && existing.status !== "retired") {
    // Already in RIO's stock (so already in Traccar): hand that unit to this customer.
    await assignToCustomer(actorUserId, existing.id, { organizationId, name: input.name }, meta);
    return { deviceId: existing.id, traccarCreated: false, fromStock: true };
  }
  if (existing) {
    throw new ConflictError(
      existing.organizationId === organizationId
        ? "This device is already registered for this customer"
        : existing.organizationId
          ? "This IMEI is registered to another customer. Use Move on the Trackers page to transfer it."
          : "This tracker is retired. Put it back in stock on the Trackers page first."
    );
  }

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
      .values({ organizationId, providerId, externalDeviceId: input.imei, imei: input.imei, model: input.model, name: input.name ?? null })
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
    metadata: { model: input.model, imeiLast4: input.imei.slice(-4), traccarCreated: traccar.created, ...(isValidImei(input.imei) ? {} : { uncheckedImei: true }) },
    ...meta
  });
  return { deviceId: dev!.id, traccarCreated: traccar.created, fromStock: false };
}

export const BulkRegisterSchema = z.object({
  model: z.string().trim().min(1).max(60),
  rows: z
    .array(z.object({ imei: z.string().trim().regex(/^\d{15}$/, "The IMEI must be exactly 15 digits"), name: z.string().trim().min(1).max(80).optional() }))
    .min(1, "Paste at least one IMEI")
    .max(BULK_IMPORT_MAX, `At most ${BULK_IMPORT_MAX} trackers per import`)
});

export type BulkRowStatus = "registered" | "already_registered" | "other_customer" | "invalid" | "failed";

/**
 * Registers many trackers for one customer. Each row goes through the same path as a single
 * registration (Traccar first, then RIO), one at a time so Traccar is never flooded. A row that
 * fails never stops the others; the caller gets a status per IMEI. IMEIs that fail the check
 * digit are refused here: in bulk there is nobody to confirm a typo.
 */
export async function registerDevicesBulk(actorUserId: string, organizationId: string, input: z.infer<typeof BulkRegisterSchema>, meta: Meta) {
  const [org] = await getDb().select({ id: schema.organizations.id, status: schema.organizations.status }).from(schema.organizations).where(eq(schema.organizations.id, organizationId));
  if (!org) throw new NotFoundError("Customer not found");
  if (org.status === "archived") throw new ConflictError("This customer is archived. Restore it before adding trackers.");
  const results: { imei: string; status: BulkRowStatus; message?: string }[] = [];
  const seen = new Set<string>();
  for (const row of input.rows) {
    if (seen.has(row.imei)) continue;
    seen.add(row.imei);
    if (!isValidImei(row.imei)) {
      results.push({ imei: row.imei, status: "invalid", message: "Fails the IMEI check; compare it with the label." });
      continue;
    }
    const [existing] = await getDb().select({ organizationId: schema.gpsDevices.organizationId }).from(schema.gpsDevices).where(eq(schema.gpsDevices.imei, row.imei));
    if (existing && existing.organizationId) {
      const same = existing.organizationId === organizationId;
      results.push({ imei: row.imei, status: same ? "already_registered" : "other_customer", message: same ? "Already registered for this customer." : "Registered to another customer; not changed." });
      continue;
    }
    try {
      await registerDevice(actorUserId, organizationId, { imei: row.imei, model: input.model, name: row.name, allowUncheckedImei: false }, meta);
      results.push({ imei: row.imei, status: "registered" });
    } catch (err) {
      if (err instanceof AppError) {
        results.push({ imei: row.imei, status: "failed", message: err.message });
      } else {
        logger.error("customers.bulk_register_row_failed", { organizationId }, err);
        results.push({ imei: row.imei, status: "failed", message: "Unexpected error; try this one again." });
      }
    }
  }
  const count = (s: BulkRowStatus) => results.filter((r) => r.status === s).length;
  const summary = { registered: count("registered"), alreadyRegistered: count("already_registered"), otherCustomer: count("other_customer"), invalid: count("invalid"), failed: count("failed") };
  await writeAudit({ action: "device.bulk_imported", actorUserId, organizationId, targetType: "organization", targetId: organizationId, metadata: { model: input.model, rows: results.length, ...summary }, ...meta });
  return { results, summary };
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

// ---------- platform admin: paged list + detail ----------

export const CustomerListQuery = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().refine((n) => [10, 25, 50, 100].includes(n)).default(25),
  search: z.string().trim().max(100).default(""),
  sort: z.enum(["name", "created", "devices", "members"]).default("name"),
  direction: z.enum(["asc", "desc"]).default("asc"),
  /** current = active + suspended (the default); archived customers only show when asked for. */
  view: z.enum(["current", "suspended", "archived", "all"]).default("current")
});
export type CustomerListQuery = z.infer<typeof CustomerListQuery>;

export interface CustomerRow extends CustomerDto {
  /** Devices that reported in the last 24 h. */
  activeDevices: number;
  status: OrganizationStatus;
  statusReason: string | null;
}

const likeP = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Super-admin only (callers check isSuperAdmin): every organization, paged in SQL. */
export async function listCustomersPage(
  q: CustomerListQuery
): Promise<{ items: CustomerRow[]; total: number; page: number; pageSize: number; counts: Record<"current" | "suspended" | "archived" | "all", number> }> {
  const viewWhere = { current: sql`o.status <> 'archived'`, suspended: sql`o.status = 'suspended'`, archived: sql`o.status = 'archived'`, all: sql`true` }[q.view];
  const search = q.search ? sql`where (o.name ilike ${likeP(q.search)} or o.slug ilike ${likeP(q.search)}) and ${viewWhere}` : sql`where ${viewWhere}`;
  const dir = q.direction === "desc" ? sql`desc` : sql`asc`;
  const order = { name: sql`lower(name) ${dir}`, created: sql`created_at ${dir}`, devices: sql`devices ${dir}`, members: sql`members ${dir}` }[q.sort];
  const statusCounts = getDb().execute<{ status: OrganizationStatus; n: number }>(sql`select status, count(*)::int as n from organizations group by status`);
  const rows = await getDb().execute<{ id: string; name: string; slug: string; created_at: Date; devices: number; members: number; active_devices: number; total: number; status: OrganizationStatus; status_reason: string | null }>(sql`
    with f as (
      select o.id, o.name, o.slug, o.created_at, o.status, o.status_reason,
        (select count(*)::int from gps_devices d where d.organization_id = o.id) as devices,
        (select count(*)::int from gps_devices d where d.organization_id = o.id and d.last_seen_at > now() - interval '24 hours') as active_devices,
        (select count(*)::int from memberships m join users u on u.id = m.user_id where m.organization_id = o.id and not u.is_super_admin) as members
      from organizations o ${search}
    )
    select *, count(*) over()::int as total from f order by ${order}, id limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`);
  const n = new Map((await statusCounts).map((c) => [c.status, c.n]));
  const active = n.get("active") ?? 0,
    suspended = n.get("suspended") ?? 0,
    archived = n.get("archived") ?? 0;
  return {
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      createdAt: new Date(r.created_at).toISOString(),
      devices: r.devices,
      members: r.members,
      activeDevices: r.active_devices,
      status: r.status,
      statusReason: r.status_reason
    })),
    total: rows.length ? Number(rows[0]!.total) : 0,
    page: q.page,
    pageSize: q.pageSize,
    counts: { current: active + suspended, suspended, archived, all: active + suspended + archived }
  };
}

export interface CustomerDetail {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
  timeZone: string;
  unitSystem: "imperial" | "metric";
  timeFormat: "12h" | "24h";
  status: OrganizationStatus;
  statusReason: string | null;
  statusChangedAt: string | null;
  statusChangedBy: string | null;
  members: { userId: string; name: string; email: string; role: string; lastSignInAt: string | null; twoStep: boolean }[];
  devices: { id: string; name: string | null; model: string | null; imei: string; imeiLast4: string; status: string; lastSeenAt: string | null; vehicleName: string | null; sim: { iccid: string; msisdn: string | null; status: string } | null }[];
}

/** Super-admin only (platform staff match full IMEIs against the labels). */
export async function getCustomerDetail(organizationId: string): Promise<CustomerDetail | null> {
  const db = getDb();
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, organizationId));
  if (!org) return null;
  const [changedBy] = org.statusChangedBy ? await db.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, org.statusChangedBy)) : [];
  const [members, devices] = await Promise.all([
    db.execute<{ user_id: string; name: string; email: string; role: string; last_sign_in: Date | null; two_factor_enabled: boolean | null }>(sql`
      select u.id as user_id, u.name, u.email, m.role, u.two_factor_enabled, (select max(s.created_at) from sessions s where s.user_id = u.id) as last_sign_in
      from memberships m join users u on u.id = m.user_id where m.organization_id = ${organizationId} and not u.is_super_admin
      order by case m.role when 'ORG_ADMIN' then 0 when 'FLEET_MANAGER' then 1 when 'DISPATCHER' then 2 else 3 end, lower(u.name)`),
    db.execute<{ id: string; name: string | null; model: string | null; imei: string; status: string; last_seen_at: Date | null; vehicle_name: string | null; iccid: string | null; msisdn: string | null; sim_status: string | null }>(sql`
      select d.id, d.name, d.model, d.imei, d.status, d.last_seen_at, v.name as vehicle_name, s.iccid, s.msisdn, s.status as sim_status
      from gps_devices d
      left join sim_cards s on s.device_id = d.id
      left join device_assignments a on a.device_id = d.id and a.organization_id = d.organization_id and a.unassigned_at is null
      left join vehicles v on v.id = a.vehicle_id and v.organization_id = d.organization_id
      where d.organization_id = ${organizationId} order by d.created_at`)
  ]);
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    createdAt: org.createdAt.toISOString(),
    status: org.status,
    statusReason: org.statusReason,
    statusChangedAt: org.statusChangedAt?.toISOString() ?? null,
    statusChangedBy: changedBy ? changedBy.name || changedBy.email : null,
    contactName: org.contactName,
    contactEmail: org.contactEmail,
    contactPhone: org.contactPhone,
    notes: org.platformNotes,
    timeZone: org.timeZone,
    unitSystem: org.unitSystem,
    timeFormat: org.timeFormat,
    members: members.map((m) => ({ userId: m.user_id, name: m.name, email: m.email, role: m.role, lastSignInAt: m.last_sign_in ? new Date(m.last_sign_in).toISOString() : null, twoStep: Boolean(m.two_factor_enabled) })),
    devices: devices.map((d) => ({ id: d.id, name: d.name, model: d.model, imei: d.imei, imeiLast4: d.imei.slice(-4), status: d.status, lastSeenAt: d.last_seen_at ? new Date(d.last_seen_at).toISOString() : null, vehicleName: d.vehicle_name, sim: d.iccid ? { iccid: d.iccid, msisdn: d.msisdn, status: d.sim_status ?? "inventory" } : null }))
  };
}

// ---------- platform admin: edit a customer's account ----------

const optText = (max: number) => z.string().trim().max(max).transform((v) => v || null);

export const UpdateCustomerSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    slug: CreateCustomerSchema.shape.slug,
    contactName: optText(200),
    contactEmail: z.union([z.literal(""), z.string().trim().toLowerCase().email().max(254)]).transform((v) => v || null),
    contactPhone: optText(40),
    notes: optText(2000),
    timeZone: TimeZoneSchema,
    unitSystem: z.enum(UNIT_SYSTEMS),
    timeFormat: z.enum(TIME_FORMATS)
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

const COLUMN = { name: "name", slug: "slug", contactName: "contactName", contactEmail: "contactEmail", contactPhone: "contactPhone", notes: "platformNotes", timeZone: "timeZone", unitSystem: "unitSystem", timeFormat: "timeFormat" } as const;

/** Platform admins edit a customer's name, short name, account contact, notes and display defaults. Audited field by field. */
export async function updateCustomer(actorUserId: string, organizationId: string, patch: z.infer<typeof UpdateCustomerSchema>, meta: Meta) {
  const db = getDb();
  const [before] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, organizationId));
  if (!before) throw new NotFoundError("Customer not found");
  const set: Record<string, unknown> = {};
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, col] of Object.entries(COLUMN) as [keyof typeof COLUMN, (typeof COLUMN)[keyof typeof COLUMN]][]) {
    const v = patch[k];
    if (v === undefined || v === before[col]) continue;
    set[col] = v;
    // Notes and contact details can be long or personal: record that they changed, not their text.
    changed[k] = k === "notes" || k === "contactEmail" || k === "contactPhone" || k === "contactName" ? { from: "…", to: "…" } : { from: before[col], to: v };
  }
  if (Object.keys(set).length === 0) return { changed: [] };
  try {
    await db.update(schema.organizations).set({ ...set, updatedAt: new Date() }).where(eq(schema.organizations.id, organizationId));
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    if (e?.code === "23505" || e?.cause?.code === "23505") throw new ConflictError("That short name (slug) is already taken");
    throw err;
  }
  if (set.timeZone !== undefined) {
    void import("./daily-stats").then((m) => m.refreshDailyStats()).catch((err) => logger.error("stats.rebuild_after_zone_change_failed", { organizationId }, err));
  }
  await writeAudit({ action: "customer.updated", actorUserId, organizationId, targetType: "organization", targetId: organizationId, metadata: changed, ...meta });
  return { changed: Object.keys(changed) };
}
