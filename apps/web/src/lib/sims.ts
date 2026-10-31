import { getDb, schema } from "@rio-gps/db";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "./audit";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { isIccid, normalizeIccid, normalizeMsisdn, parseInventoryLines } from "./inventory-parse";

/**
 * Data SIMs (platform admins only). The point of this list is to know, for every SIM RIO pays
 * for, which tracker and customer it serves, and to catch the two costly mistakes:
 * - a SIM that is active (billed) but not in a tracker that is with a customer;
 * - a tracker with a customer whose SIM is suspended or cancelled (it can't report).
 */

export const SIM_STATUSES = ["inventory", "active", "suspended", "cancelled"] as const;
export type SimStatus = (typeof SIM_STATUSES)[number];
type Meta = { ipAddress: string | null; userAgent: string | null };

const Iccid = z
  .string()
  .transform((v) => normalizeIccid(v))
  .refine(isIccid, "The SIM number (ICCID) must be 18 to 22 digits");
const Msisdn = z
  .string()
  .trim()
  .max(30)
  .transform((v, c) => {
    if (!v) return null;
    const n = normalizeMsisdn(v);
    if (!n) {
      c.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a phone number, e.g. +1 805 555 0100" });
      return z.NEVER;
    }
    return n;
  });
const Text = (max: number) => z.string().trim().max(max).transform((v) => v || null);
/** Dollars as typed ("12.50") → cents. */
const Cost = z
  .union([z.number(), z.string()])
  .transform((v, c) => {
    if (v === "" || v === null) return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n) || n < 0 || n > 10_000) {
      c.addIssue({ code: z.ZodIssueCode.custom, message: "Monthly cost must be between 0 and 10,000" });
      return z.NEVER;
    }
    return Math.round(n * 100);
  });

export const SimInputSchema = z.object({
  iccid: Iccid,
  msisdn: Msisdn.optional(),
  carrier: Text(60).optional(),
  plan: Text(80).optional(),
  apn: Text(80).optional(),
  status: z.enum(SIM_STATUSES).default("inventory"),
  monthlyCost: Cost.nullable().optional(),
  notes: Text(500).optional()
});
export const SimPatchSchema = SimInputSchema.omit({ iccid: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export const SimLinkSchema = z.object({ imei: z.string().trim().regex(/^\d{15}$/, "Enter the tracker's 15-digit IMEI").nullable() });
export const SimBulkSchema = z.object({
  text: z.string().max(60_000),
  carrier: Text(60).optional(),
  plan: Text(80).optional(),
  apn: Text(80).optional(),
  status: z.enum(SIM_STATUSES).default("inventory"),
  monthlyCost: Cost.nullable().optional()
});

function uniqueViolation(err: unknown) {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export async function createSim(actorUserId: string, input: z.infer<typeof SimInputSchema>, meta: Meta) {
  const now = new Date();
  try {
    const [sim] = await getDb()
      .insert(schema.simCards)
      .values({
        iccid: input.iccid,
        msisdn: input.msisdn ?? null,
        carrier: input.carrier ?? null,
        plan: input.plan ?? null,
        apn: input.apn ?? null,
        status: input.status,
        monthlyCostCents: input.monthlyCost ?? null,
        notes: input.notes ?? null,
        activatedAt: input.status === "active" ? now : null
      })
      .returning({ id: schema.simCards.id });
    await writeAudit({ action: "sim.added", actorUserId, organizationId: null, targetType: "sim", targetId: sim!.id, metadata: { iccidLast4: input.iccid.slice(-4), status: input.status }, ...meta });
    return { simId: sim!.id };
  } catch (err) {
    if (uniqueViolation(err)) throw new ConflictError("This SIM number (ICCID) is already in the list");
    throw err;
  }
}

export async function updateSim(actorUserId: string, simId: string, patch: z.infer<typeof SimPatchSchema>, meta: Meta) {
  const db = getDb();
  const [before] = await db.select().from(schema.simCards).where(eq(schema.simCards.id, simId));
  if (!before) throw new NotFoundError("SIM not found");
  const now = new Date();
  await db
    .update(schema.simCards)
    .set({
      ...(patch.msisdn !== undefined ? { msisdn: patch.msisdn } : {}),
      ...(patch.carrier !== undefined ? { carrier: patch.carrier } : {}),
      ...(patch.plan !== undefined ? { plan: patch.plan } : {}),
      ...(patch.apn !== undefined ? { apn: patch.apn } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.monthlyCost !== undefined ? { monthlyCostCents: patch.monthlyCost } : {}),
      ...(patch.status !== undefined ? { status: patch.status, ...(patch.status === "active" && before.status !== "active" ? { activatedAt: now } : {}) } : {}),
      updatedAt: now
    })
    .where(eq(schema.simCards.id, simId));
  const changed = Object.keys(patch);
  await writeAudit({
    action: patch.status && patch.status !== before.status ? `sim.${patch.status === "active" ? "activated" : patch.status}` : "sim.updated",
    actorUserId,
    organizationId: null,
    targetType: "sim",
    targetId: simId,
    metadata: { iccidLast4: before.iccid.slice(-4), fields: changed, ...(patch.status && patch.status !== before.status ? { from: before.status, to: patch.status } : {}) },
    ...meta
  });
}

/** Puts a SIM in a tracker (by IMEI), replacing the tracker's previous SIM, or takes it out (imei null). */
export async function linkSim(actorUserId: string, simId: string, input: z.infer<typeof SimLinkSchema>, meta: Meta) {
  const now = new Date();
  const out = await getDb().transaction(async (tx) => {
    const [sim] = await tx.select().from(schema.simCards).where(eq(schema.simCards.id, simId)).for("update");
    if (!sim) throw new NotFoundError("SIM not found");
    if (input.imei === null) {
      await tx.update(schema.simCards).set({ deviceId: null, updatedAt: now }).where(eq(schema.simCards.id, sim.id));
      return { iccid: sim.iccid, deviceId: null, organizationId: null, replaced: null as string | null };
    }
    const [d] = await tx.select({ id: schema.gpsDevices.id, organizationId: schema.gpsDevices.organizationId }).from(schema.gpsDevices).where(eq(schema.gpsDevices.imei, input.imei));
    if (!d) throw new ValidationError("No tracker with this IMEI. Add it to stock first.");
    const [prev] = await tx.update(schema.simCards).set({ deviceId: null, updatedAt: now }).where(and(eq(schema.simCards.deviceId, d.id), sql`${schema.simCards.id} <> ${sim.id}`)).returning({ iccid: schema.simCards.iccid });
    await tx.update(schema.simCards).set({ deviceId: d.id, updatedAt: now }).where(eq(schema.simCards.id, sim.id));
    return { iccid: sim.iccid, deviceId: d.id, organizationId: d.organizationId, replaced: prev?.iccid ?? null };
  });
  await writeAudit({
    action: out.deviceId ? "sim.linked" : "sim.unlinked",
    actorUserId,
    organizationId: out.organizationId,
    targetType: "sim",
    targetId: simId,
    metadata: { iccidLast4: out.iccid.slice(-4), ...(out.deviceId ? { deviceId: out.deviceId } : {}), ...(out.replaced ? { replacedIccidLast4: out.replaced.slice(-4) } : {}) },
    ...meta
  });
  return { replacedIccidLast4: out.replaced?.slice(-4) ?? null };
}

export type SimBulkStatus = "added" | "linked" | "already_listed" | "invalid" | "failed";

/** Adds SIMs from a pasted list (ICCID, optional phone number, optional tracker IMEI to put it in). */
export async function importSims(actorUserId: string, input: z.infer<typeof SimBulkSchema>, meta: Meta) {
  const lines = parseInventoryLines(input.text);
  if (lines.length === 0) throw new ValidationError("Paste at least one SIM number");
  if (lines.length > 500) throw new ValidationError("At most 500 SIMs per import");
  const results: { line: number; iccid: string | null; status: SimBulkStatus; message?: string }[] = [];
  for (const l of lines) {
    if (!l.iccid) {
      results.push({ line: l.line, iccid: null, status: "invalid", message: "No SIM number (18-22 digits) on this line" });
      continue;
    }
    try {
      const { simId } = await createSim(actorUserId, { iccid: l.iccid, msisdn: l.msisdn, carrier: input.carrier ?? null, plan: input.plan ?? null, apn: input.apn ?? null, status: input.status, monthlyCost: input.monthlyCost ?? null, notes: null }, meta);
      if (l.imei) {
        try {
          await linkSim(actorUserId, simId, { imei: l.imei }, meta);
          results.push({ line: l.line, iccid: l.iccid, status: "linked" });
        } catch (err) {
          results.push({ line: l.line, iccid: l.iccid, status: "added", message: `Added, but not put in the tracker: ${(err as Error).message}` });
        }
      } else results.push({ line: l.line, iccid: l.iccid, status: "added" });
    } catch (err) {
      if (err instanceof ConflictError) results.push({ line: l.line, iccid: l.iccid, status: "already_listed", message: "Already in the list" });
      else results.push({ line: l.line, iccid: l.iccid, status: "failed", message: (err as Error).message });
    }
  }
  const count = (s: SimBulkStatus) => results.filter((r) => r.status === s).length;
  return { results, summary: { added: count("added") + count("linked"), linked: count("linked"), alreadyListed: count("already_listed"), invalid: count("invalid"), failed: count("failed") } };
}

// ---------- list ----------

export const SIM_VIEWS = ["all", "attention", "active", "inventory", "suspended", "cancelled"] as const;
export const SimListQuery = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().refine((n) => [10, 25, 50, 100].includes(n)).default(25),
  search: z.string().trim().max(100).default(""),
  view: z.enum(SIM_VIEWS).default("all"),
  sort: z.enum(["iccid", "status", "customer", "updated"]).default("updated"),
  direction: z.enum(["asc", "desc"]).default("desc")
});
export type SimListQuery = z.infer<typeof SimListQuery>;

export type SimAttention = "active_unused" | "deployed_not_active" | null;

export interface SimRow {
  id: string;
  iccid: string;
  msisdn: string | null;
  carrier: string | null;
  plan: string | null;
  apn: string | null;
  status: SimStatus;
  monthlyCostCents: number | null;
  notes: string | null;
  activatedAt: string | null;
  device: { id: string; imei: string; name: string | null; model: string | null; status: string } | null;
  customer: { id: string; name: string } | null;
  attention: SimAttention;
}

const likeP = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
/** Billed but not serving a customer (no tracker, a stock tracker or a retired one). */
const ACTIVE_UNUSED = sql`(s.status = 'active' and (d.id is null or d.organization_id is null or d.status = 'retired'))`;
/** A tracker with a customer that can't report because its SIM is off. */
const DEPLOYED_NOT_ACTIVE = sql`(s.status in ('suspended', 'cancelled', 'inventory') and d.organization_id is not null and d.status = 'active')`;

export async function listSims(q: SimListQuery) {
  const search = q.search
    ? sql`and (s.iccid like ${likeP(q.search.replace(/\s/g, ""))} or coalesce(s.msisdn, '') like ${likeP(q.search.replace(/[\s()-]/g, ""))} or coalesce(s.carrier, '') ilike ${likeP(q.search)} or coalesce(d.imei, '') like ${likeP(q.search)} or coalesce(o.name, '') ilike ${likeP(q.search)})`
    : sql``;
  const view = {
    all: sql`true`,
    attention: sql`(${ACTIVE_UNUSED} or ${DEPLOYED_NOT_ACTIVE})`,
    active: sql`s.status = 'active'`,
    inventory: sql`s.status = 'inventory'`,
    suspended: sql`s.status = 'suspended'`,
    cancelled: sql`s.status = 'cancelled'`
  }[q.view];
  const dir = q.direction === "desc" ? sql`desc` : sql`asc`;
  const order = { iccid: sql`s.iccid ${dir}`, status: sql`s.status ${dir}`, customer: sql`lower(o.name) ${dir} nulls last`, updated: sql`s.updated_at ${dir}` }[q.sort];
  const base = sql`from sim_cards s left join gps_devices d on d.id = s.device_id left join organizations o on o.id = d.organization_id where true ${search}`;
  const db = getDb();
  const [rows, [counts]] = await Promise.all([
    db.execute<Record<string, unknown>>(sql`
      select s.*, d.imei as d_imei, d.name as d_name, d.model as d_model, d.status as d_status, o.id as o_id, o.name as o_name,
        case when ${ACTIVE_UNUSED} then 'active_unused' when ${DEPLOYED_NOT_ACTIVE} then 'deployed_not_active' end as attention,
        count(*) over()::int as total
      ${base} and ${view} order by ${order}, s.id limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`),
    db.execute<{ all: number; attention: number; active: number; inventory: number; suspended: number; cancelled: number; monthly: number; wasted: number }>(sql`
      select count(*)::int as all,
        count(*) filter (where ${ACTIVE_UNUSED} or ${DEPLOYED_NOT_ACTIVE})::int as attention,
        count(*) filter (where s.status = 'active')::int as active,
        count(*) filter (where s.status = 'inventory')::int as inventory,
        count(*) filter (where s.status = 'suspended')::int as suspended,
        count(*) filter (where s.status = 'cancelled')::int as cancelled,
        coalesce(sum(s.monthly_cost_cents) filter (where s.status = 'active'), 0)::int as monthly,
        coalesce(sum(s.monthly_cost_cents) filter (where ${ACTIVE_UNUSED}), 0)::int as wasted
      ${base}`)
  ]);
  return {
    items: rows.map(
      (r): SimRow => ({
        id: String(r.id),
        iccid: String(r.iccid),
        msisdn: (r.msisdn as string | null) ?? null,
        carrier: (r.carrier as string | null) ?? null,
        plan: (r.plan as string | null) ?? null,
        apn: (r.apn as string | null) ?? null,
        status: r.status as SimStatus,
        monthlyCostCents: (r.monthly_cost_cents as number | null) ?? null,
        notes: (r.notes as string | null) ?? null,
        activatedAt: r.activated_at ? new Date(r.activated_at as string).toISOString() : null,
        device: r.device_id ? { id: String(r.device_id), imei: String(r.d_imei), name: (r.d_name as string | null) ?? null, model: (r.d_model as string | null) ?? null, status: String(r.d_status) } : null,
        customer: r.o_id ? { id: String(r.o_id), name: String(r.o_name) } : null,
        attention: (r.attention as SimAttention) ?? null
      })
    ),
    total: rows.length ? Number(rows[0]!.total) : 0,
    page: q.page,
    pageSize: q.pageSize,
    counts: counts ?? { all: 0, attention: 0, active: 0, inventory: 0, suspended: 0, cancelled: 0, monthly: 0, wasted: 0 }
  };
}
