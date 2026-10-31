import { isValidImei } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "./audit";
import { AppError, ConflictError, NotFoundError, ValidationError } from "./errors";
import { isIccid, normalizeIccid, parseInventoryLines } from "./inventory-parse";
import { logger } from "./logger";
import { getTraccarAdmin } from "./traccar";

/**
 * Platform tracker inventory (platform admins only; callers check isSuperAdmin).
 *
 *   add to stock ──► assign to customer ──► move to another customer
 *        ▲                     │                       │
 *        └──── return to stock ◄───────────────────────┘ ──► retire
 *
 * Moving or returning a tracker never moves data: positions, trips and alerts stay with the
 * customer they were recorded for (they carry their own organization_id). What is cleared is
 * everything that would leak one customer's state to the next: the vehicle it was mounted on,
 * its latest position, alert-rule state and its customer-facing name.
 */

type Meta = { ipAddress: string | null; userAgent: string | null };
type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

const ImeiSchema = z
  .string()
  .trim()
  .regex(/^\d{15}$/, "The IMEI must be exactly 15 digits");

export const AddToStockSchema = z.object({
  imei: ImeiSchema,
  model: z.string().trim().min(1).max(60),
  serialNumber: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(500).optional(),
  /** Optional SIM in the tracker: linked if known, otherwise added to the SIM list. */
  iccid: z.string().trim().max(30).optional(),
  allowUncheckedImei: z.boolean().default(false)
});

export const BulkStockSchema = z.object({
  model: z.string().trim().min(1).max(60),
  text: z.string().max(60_000)
});

export const AssignSchema = z.object({ organizationId: z.string().uuid(), name: z.string().trim().min(1).max(80).optional() });
export const MoveSchema = z.object({ organizationId: z.string().uuid(), reason: z.string().trim().min(3).max(300) });
export const ReturnSchema = z.object({ reason: z.string().trim().min(3).max(300), retire: z.boolean().default(false) });
export const StockStatusSchema = z.object({ retired: z.boolean(), reason: z.string().trim().min(3).max(300) });
export const InventoryPatchSchema = z
  .object({ model: z.string().trim().min(1).max(60), serialNumber: z.string().trim().max(60).nullable(), notes: z.string().trim().max(500).nullable() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

async function lockDevice(tx: Tx, deviceId: string) {
  const [d] = await tx.select().from(schema.gpsDevices).where(eq(schema.gpsDevices.id, deviceId)).for("update");
  if (!d) throw new NotFoundError("Tracker not found");
  return d;
}

async function customerFor(tx: Tx, organizationId: string) {
  const [o] = await tx.select({ id: schema.organizations.id, name: schema.organizations.name, status: schema.organizations.status }).from(schema.organizations).where(eq(schema.organizations.id, organizationId));
  if (!o) throw new NotFoundError("Customer not found");
  if (o.status === "archived") throw new ConflictError(`${o.name} is archived. Restore it before giving it trackers.`);
  return o;
}

/** The customer's provider row (created on first use). */
export async function ensureProvider(tx: Tx, organizationId: string): Promise<string> {
  const [p] = await tx.select({ id: schema.gpsProviders.id }).from(schema.gpsProviders).where(eq(schema.gpsProviders.organizationId, organizationId)).limit(1);
  if (p) return p.id;
  const [created] = await tx.insert(schema.gpsProviders).values({ organizationId, kind: "traccar", name: "Traccar", apiBaseUrl: "http://traccar:8082" }).returning({ id: schema.gpsProviders.id });
  return created!.id;
}

/** Removes everything customer-specific from a tracker that is leaving its customer. */
async function detachFromCustomer(tx: Tx, device: { id: string; organizationId: string | null }, now: Date) {
  if (!device.organizationId) return;
  await tx
    .update(schema.deviceAssignments)
    .set({ unassignedAt: now })
    .where(and(eq(schema.deviceAssignments.deviceId, device.id), eq(schema.deviceAssignments.organizationId, device.organizationId), isNull(schema.deviceAssignments.unassignedAt)));
  await tx.delete(schema.currentLocations).where(eq(schema.currentLocations.deviceId, device.id));
  await tx.delete(schema.alertRuleState).where(eq(schema.alertRuleState.deviceId, device.id));
}

function conflictWhere(existing: { organizationId: string | null; status: string }, orgName: string | null) {
  if (!existing.organizationId) return existing.status === "retired" ? "This IMEI is already in inventory (retired)." : "This IMEI is already in stock.";
  return `This IMEI is already registered to ${orgName ?? "a customer"}.`;
}

async function findByImei(imei: string) {
  const [row] = await getDb()
    .select({ id: schema.gpsDevices.id, organizationId: schema.gpsDevices.organizationId, status: schema.gpsDevices.status, orgName: schema.organizations.name })
    .from(schema.gpsDevices)
    .leftJoin(schema.organizations, eq(schema.organizations.id, schema.gpsDevices.organizationId))
    .where(eq(schema.gpsDevices.imei, imei));
  return row ?? null;
}

/** Links a SIM (by ICCID) to a tracker, adding the SIM to the list when it is new. */
async function linkSimByIccid(tx: Tx, deviceId: string, iccidRaw: string, msisdn: string | null, now: Date): Promise<{ simId: string; created: boolean }> {
  const iccid = normalizeIccid(iccidRaw);
  if (!isIccid(iccid)) throw new ValidationError("The SIM number (ICCID) must be 18 to 22 digits");
  const [sim] = await tx.select().from(schema.simCards).where(eq(schema.simCards.iccid, iccid)).for("update");
  if (sim?.deviceId && sim.deviceId !== deviceId) throw new ConflictError(`SIM …${iccid.slice(-4)} is already in another tracker`);
  await tx.update(schema.simCards).set({ deviceId: null, updatedAt: now }).where(and(eq(schema.simCards.deviceId, deviceId), sql`${schema.simCards.iccid} <> ${iccid}`));
  if (sim) {
    await tx.update(schema.simCards).set({ deviceId, ...(msisdn && !sim.msisdn ? { msisdn } : {}), updatedAt: now }).where(eq(schema.simCards.id, sim.id));
    return { simId: sim.id, created: false };
  }
  const [created] = await tx.insert(schema.simCards).values({ iccid, msisdn, deviceId, status: "inventory" }).returning({ id: schema.simCards.id });
  return { simId: created!.id, created: true };
}

/** Adds a new tracker to RIO's stock: Traccar first (so it reports from the first minute), then RIO. */
export async function addToStock(actorUserId: string, input: z.infer<typeof AddToStockSchema>, meta: Meta, opts: { msisdn?: string | null } = {}) {
  if (!isValidImei(input.imei) && !input.allowUncheckedImei) {
    throw new ValidationError("This number does not pass the IMEI check, which usually means one digit is mistyped. Compare it with the device label.", { code: "IMEI_CHECK_DIGIT" });
  }
  const existing = await findByImei(input.imei);
  if (existing) throw new ConflictError(conflictWhere(existing, existing.orgName));
  let traccar;
  try {
    traccar = await getTraccarAdmin().ensureDevice(`${input.model}-${input.imei.slice(-4)}`, input.imei);
  } catch (err) {
    logger.error("inventory.traccar_register_failed", {}, err);
    throw new AppError("TRACCAR_UNAVAILABLE", 502, "Could not register the tracker in Traccar; nothing was saved. Try again.");
  }
  const now = new Date();
  const out = await getDb()
    .transaction(async (tx) => {
      const [dev] = await tx
        .insert(schema.gpsDevices)
        .values({ organizationId: null, providerId: null, externalDeviceId: input.imei, imei: input.imei, model: input.model, serialNumber: input.serialNumber || null, platformNotes: input.notes || null, inventoryChangedAt: now })
        .returning({ id: schema.gpsDevices.id });
      const sim = input.iccid ? await linkSimByIccid(tx, dev!.id, input.iccid, opts.msisdn ?? null, now) : null;
      return { deviceId: dev!.id, sim };
    })
    .catch((err) => {
      const e = err as { code?: string; cause?: { code?: string } };
      if (e?.code === "23505" || e?.cause?.code === "23505") throw new ConflictError("This IMEI was just added by another request");
      throw err;
    });
  await writeAudit({
    action: "device.stocked",
    actorUserId,
    organizationId: null,
    targetType: "device",
    targetId: out.deviceId,
    metadata: { model: input.model, imeiLast4: input.imei.slice(-4), traccarCreated: traccar.created, ...(out.sim ? { simLinked: true } : {}) },
    ...meta
  });
  return { deviceId: out.deviceId, traccarCreated: traccar.created, simLinked: Boolean(out.sim) };
}

export type BulkStockStatus = "added" | "already_in_stock" | "with_customer" | "invalid" | "failed";

/** Adds many trackers (and their SIMs) from a pasted list. One line never stops the others. */
export async function addToStockBulk(actorUserId: string, input: z.infer<typeof BulkStockSchema>, meta: Meta) {
  const lines = parseInventoryLines(input.text);
  if (lines.length === 0) throw new ValidationError("Paste at least one IMEI");
  if (lines.length > 500) throw new ValidationError("At most 500 trackers per import");
  const results: { line: number; imei: string | null; status: BulkStockStatus; message?: string }[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    if (!l.imei) {
      results.push({ line: l.line, imei: null, status: "invalid", message: l.problem ?? "No IMEI on this line" });
      continue;
    }
    if (seen.has(l.imei)) continue;
    seen.add(l.imei);
    if (!isValidImei(l.imei)) {
      results.push({ line: l.line, imei: l.imei, status: "invalid", message: "Fails the IMEI check; compare it with the label." });
      continue;
    }
    const existing = await findByImei(l.imei);
    if (existing) {
      results.push({ line: l.line, imei: l.imei, status: existing.organizationId ? "with_customer" : "already_in_stock", message: conflictWhere(existing, existing.orgName) });
      continue;
    }
    try {
      await addToStock(actorUserId, { imei: l.imei, model: input.model, iccid: l.iccid ?? undefined, allowUncheckedImei: false }, meta, { msisdn: l.msisdn });
      results.push({ line: l.line, imei: l.imei, status: "added" });
    } catch (err) {
      if (err instanceof AppError) results.push({ line: l.line, imei: l.imei, status: "failed", message: err.message });
      else {
        logger.error("inventory.bulk_row_failed", {}, err);
        results.push({ line: l.line, imei: l.imei, status: "failed", message: "Unexpected error; try this one again." });
      }
    }
  }
  const count = (s: BulkStockStatus) => results.filter((r) => r.status === s).length;
  return { results, summary: { added: count("added"), alreadyInStock: count("already_in_stock"), withCustomer: count("with_customer"), invalid: count("invalid"), failed: count("failed") } };
}

/** Gives a tracker from stock to a customer. */
export async function assignToCustomer(actorUserId: string, deviceId: string, input: z.infer<typeof AssignSchema>, meta: Meta) {
  const now = new Date();
  const out = await getDb().transaction(async (tx) => {
    const d = await lockDevice(tx, deviceId);
    if (d.organizationId) throw new ConflictError("This tracker is already with a customer. Use Move instead.");
    if (d.status === "retired") throw new ConflictError("This tracker is retired. Put it back in stock first.");
    const org = await customerFor(tx, input.organizationId);
    const providerId = await ensureProvider(tx, org.id);
    await tx
      .update(schema.gpsDevices)
      .set({ organizationId: org.id, providerId, status: "active", name: input.name ?? null, inventoryChangedAt: now, updatedAt: now })
      .where(eq(schema.gpsDevices.id, d.id));
    return { imei: d.imei, org };
  });
  await writeAudit({ action: "device.assigned_to_customer", actorUserId, organizationId: out.org.id, targetType: "device", targetId: deviceId, metadata: { imeiLast4: out.imei.slice(-4) }, ...meta });
  return { organizationId: out.org.id };
}

/** Moves a tracker straight from one customer to another (history stays with the first). */
export async function moveToCustomer(actorUserId: string, deviceId: string, input: z.infer<typeof MoveSchema>, meta: Meta) {
  const now = new Date();
  const out = await getDb().transaction(async (tx) => {
    const d = await lockDevice(tx, deviceId);
    if (!d.organizationId) throw new ConflictError("This tracker is in stock. Use Assign instead.");
    if (d.organizationId === input.organizationId) throw new ConflictError("The tracker is already with this customer");
    const to = await customerFor(tx, input.organizationId);
    await detachFromCustomer(tx, d, now);
    const providerId = await ensureProvider(tx, to.id);
    await tx
      .update(schema.gpsDevices)
      .set({ organizationId: to.id, providerId, status: "active", name: null, inventoryChangedAt: now, updatedAt: now })
      .where(eq(schema.gpsDevices.id, d.id));
    return { from: d.organizationId, to: to.id, imei: d.imei };
  });
  const md = { imeiLast4: out.imei.slice(-4), reason: input.reason };
  await writeAudit({ action: "device.moved_out", actorUserId, organizationId: out.from, targetType: "device", targetId: deviceId, metadata: { ...md, toOrganizationId: out.to }, ...meta });
  await writeAudit({ action: "device.moved_in", actorUserId, organizationId: out.to, targetType: "device", targetId: deviceId, metadata: { ...md, fromOrganizationId: out.from }, ...meta });
  return out;
}

/** Takes a tracker back from its customer into stock (or straight to retired). */
export async function returnToStock(actorUserId: string, deviceId: string, input: z.infer<typeof ReturnSchema>, meta: Meta) {
  const now = new Date();
  const out = await getDb().transaction(async (tx) => {
    const d = await lockDevice(tx, deviceId);
    if (!d.organizationId) throw new ConflictError("This tracker is already in stock");
    await detachFromCustomer(tx, d, now);
    await tx
      .update(schema.gpsDevices)
      .set({ organizationId: null, providerId: null, name: null, status: input.retire ? "retired" : "active", inventoryChangedAt: now, updatedAt: now })
      .where(eq(schema.gpsDevices.id, d.id));
    return { from: d.organizationId, imei: d.imei };
  });
  await writeAudit({
    action: input.retire ? "device.returned_retired" : "device.returned_to_stock",
    actorUserId,
    organizationId: out.from,
    targetType: "device",
    targetId: deviceId,
    metadata: { imeiLast4: out.imei.slice(-4), reason: input.reason },
    ...meta
  });
  return out;
}

/** Retire a stock tracker (faulty, lost, end of life) or put a retired one back in stock. */
export async function setStockRetired(actorUserId: string, deviceId: string, input: z.infer<typeof StockStatusSchema>, meta: Meta) {
  const now = new Date();
  const imei = await getDb().transaction(async (tx) => {
    const d = await lockDevice(tx, deviceId);
    if (d.organizationId) throw new ConflictError("Return the tracker from its customer first");
    if ((d.status === "retired") === input.retired) throw new ConflictError(input.retired ? "Already retired" : "Already in stock");
    await tx.update(schema.gpsDevices).set({ status: input.retired ? "retired" : "active", inventoryChangedAt: now, updatedAt: now }).where(eq(schema.gpsDevices.id, d.id));
    return d.imei;
  });
  await writeAudit({ action: input.retired ? "device.retired" : "device.unretired", actorUserId, organizationId: null, targetType: "device", targetId: deviceId, metadata: { imeiLast4: imei.slice(-4), reason: input.reason }, ...meta });
}

export async function updateInventoryDetails(actorUserId: string, deviceId: string, patch: z.infer<typeof InventoryPatchSchema>, meta: Meta) {
  const [d] = await getDb()
    .update(schema.gpsDevices)
    .set({
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.serialNumber !== undefined ? { serialNumber: patch.serialNumber || null } : {}),
      ...(patch.notes !== undefined ? { platformNotes: patch.notes || null } : {}),
      updatedAt: new Date()
    })
    .where(eq(schema.gpsDevices.id, deviceId))
    .returning({ id: schema.gpsDevices.id, organizationId: schema.gpsDevices.organizationId });
  if (!d) throw new NotFoundError("Tracker not found");
  await writeAudit({ action: "device.inventory_updated", actorUserId, organizationId: d.organizationId, targetType: "device", targetId: deviceId, metadata: { fields: Object.keys(patch) }, ...meta });
}
