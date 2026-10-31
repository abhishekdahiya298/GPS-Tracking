import { createHash, randomBytes } from "node:crypto";
import type { TenantContext } from "@rio-gps/core";
import {
  LOAD_RADIUS_DEFAULT_M,
  LOAD_RADIUS_MAX_M,
  LOAD_RADIUS_MIN_M,
  LOAD_STATUSES,
  estimateLoadEta,
  isLoadEnded,
  isLoadPositionStale,
  isLoadTracking,
  type LoadEventType,
  type LoadStatus
} from "@rio-gps/core/loads";
import { getDb, schema } from "@rio-gps/db";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "./audit";
import { getServerEnv } from "./env";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { assertRateLimit } from "./rate-limit";
import { sendSms, smsConfigured, type SmsResult } from "./sms";

/**
 * Broker loads (the signed-in side). A load is tracked through the driver's phone, and only
 * with the driver's consent, from accepting the invite until the load ends.
 *
 * Links: the driver link (/d#token) and the shipper link (/track#token) carry 256 random bits
 * in the URL fragment; only SHA-256 hashes are stored, so a link is shown once and getting a
 * new one replaces the old one.
 */
type Meta = { ipAddress: string | null; userAgent: string | null };

export const hashLoadToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const LoadTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const newToken = () => randomBytes(32).toString("base64url");

/** Invites (text messages) per load per hour: bounds SMS cost and annoyance. */
const INVITES_PER_LOAD_PER_HOUR = 5;
/** Trail points returned for the detail map (the newest ones). */
const TRAIL_LIMIT = 2_000;

/**
 * Accepts the ways people type phone numbers; returns E.164 or null.
 * Ten digits are taken as North American (+1), the region RIO serves.
 */
export function normalizePhone(raw: string): string | null {
  const s = raw.trim().replace(/[\s().-]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s;
  if (/^\d{10}$/.test(s)) return `+1${s}`;
  if (/^1\d{10}$/.test(s)) return `+${s}`;
  return null;
}

const PhoneSchema = z
  .string()
  .max(30)
  .transform((v, c) => {
    const p = normalizePhone(v);
    if (!p) {
      c.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a mobile number like (416) 555-0123 or +14165550123" });
      return z.NEVER;
    }
    return p;
  });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const StopSchema = z.object({
  name: optionalText(80),
  address: z.string().trim().min(3).max(300),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusM: z.number().int().min(LOAD_RADIUS_MIN_M).max(LOAD_RADIUS_MAX_M).default(LOAD_RADIUS_DEFAULT_M),
  appointmentAt: z
    .string()
    .datetime({ offset: true })
    .nullish()
    .transform((v) => (v ? new Date(v) : null))
});

const LoadFields = z.object({
  reference: z.string().trim().min(1).max(40),
  carrierName: optionalText(120),
  driverName: optionalText(80),
  driverPhone: PhoneSchema.nullish().transform((v) => v ?? null),
  notes: optionalText(1_000),
  pickup: StopSchema,
  delivery: StopSchema
});

/**
 * phone: tracked through the driver's phone (driver link, consent).
 * vehicle: tracked by one of the organization's own vehicles' RIO tracker; starts at once.
 */
export const LoadInputSchema = LoadFields.extend({
  trackingMode: z.enum(["phone", "vehicle"]).default("phone"),
  vehicleId: z.string().uuid().nullish().transform((v) => v ?? null),
  /** Text the driver the invite now (when SMS is set up). */
  sendInvite: z.boolean().default(true)
}).superRefine((v, c) => {
  if (v.trackingMode === "phone" && !v.driverPhone) c.addIssue({ code: z.ZodIssueCode.custom, path: ["driverPhone"], message: "Enter the driver's mobile number" });
  if (v.trackingMode === "vehicle" && !v.vehicleId) c.addIssue({ code: z.ZodIssueCode.custom, path: ["vehicleId"], message: "Choose the vehicle that hauls this load" });
});
export type LoadInput = z.infer<typeof LoadInputSchema>;

/** How a load is tracked is fixed at creation; a vehicle-mode load can switch vehicles. */
export const LoadPatchSchema = LoadFields.extend({ vehicleId: z.string().uuid() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const LoadActionSchema = z.object({ action: z.enum(["delivered", "cancel"]) });

export const LOAD_LIST_FILTERS = ["active", "ended", "all"] as const;

export interface LoadStopDto {
  name: string | null;
  address: string;
  latitude: number;
  longitude: number;
  radiusM: number;
  appointmentAt: string | null;
}

export interface LoadSummaryDto {
  id: string;
  reference: string;
  status: LoadStatus;
  carrierName: string | null;
  driverName: string | null;
  driverPhone: string | null;
  trackingMode: "phone" | "vehicle";
  vehicle: { id: string; name: string } | null;
  pickup: LoadStopDto;
  delivery: LoadStopDto;
  lastPosition: { latitude: number; longitude: number; accuracyM: number | null; speedKph: number | null; at: string } | null;
  /** The driver accepted, then paused sharing. */
  sharingStopped: boolean;
  /** Tracking, but no position for 30 minutes. */
  stale: boolean;
  eta: { target: "pickup" | "delivery"; at: string; distanceM: number; lateByMinutes: number | null; late: boolean } | null;
  hasShipperLink: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LoadEventDto {
  type: LoadEventType;
  at: string;
  actorName: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface LoadDetailDto extends LoadSummaryDto {
  notes: string | null;
  inviteSentAt: string | null;
  acceptedAt: string | null;
  endedAt: string | null;
  createdByName: string | null;
  events: LoadEventDto[];
  /** [lon, lat, epoch ms], oldest first. */
  trail: [number, number, number][];
  smsAvailable: boolean;
}

type LoadRow = typeof schema.loads.$inferSelect;

const stopDto = (r: LoadRow, k: "pickup" | "delivery"): LoadStopDto => ({
  name: r[`${k}Name`],
  address: r[`${k}Address`],
  latitude: r[`${k}Lat`],
  longitude: r[`${k}Lon`],
  radiusM: r[`${k}RadiusM`],
  appointmentAt: r[`${k}AppointmentAt`]?.toISOString() ?? null
});

export function toLoadSummary(r: LoadRow, now = new Date(), vehicleName: string | null = null): LoadSummaryDto {
  const last =
    r.lastLat !== null && r.lastLon !== null && r.lastPositionAt
      ? { latitude: r.lastLat, longitude: r.lastLon, accuracyM: r.lastAccuracyM, speedKph: r.lastSpeedKph, at: r.lastPositionAt.toISOString() }
      : null;
  const pickup = { latitude: r.pickupLat, longitude: r.pickupLon, radiusM: r.pickupRadiusM, appointmentAt: r.pickupAppointmentAt };
  const delivery = { latitude: r.deliveryLat, longitude: r.deliveryLon, radiusM: r.deliveryRadiusM, appointmentAt: r.deliveryAppointmentAt };
  const eta = last && r.lastPositionAt && !r.sharingStoppedAt ? estimateLoadEta(r.status, last, r.lastPositionAt, pickup, delivery) : null;
  return {
    id: r.id,
    reference: r.reference,
    status: r.status,
    carrierName: r.carrierName,
    driverName: r.driverName,
    driverPhone: r.driverPhone,
    trackingMode: r.trackingMode,
    vehicle: r.vehicleId ? { id: r.vehicleId, name: vehicleName ?? "Vehicle" } : null,
    pickup: stopDto(r, "pickup"),
    delivery: stopDto(r, "delivery"),
    lastPosition: last,
    sharingStopped: r.sharingStoppedAt !== null && isLoadTracking(r.status),
    // Counted from acceptance until the first position arrives.
    stale: isLoadTracking(r.status) && r.sharingStoppedAt === null && isLoadPositionStale(r.lastPositionAt ?? r.acceptedAt ?? r.createdAt, now),
    eta: eta ? { target: eta.target, at: eta.eta.toISOString(), distanceM: eta.distanceM, lateByMinutes: eta.lateByMinutes, late: eta.late } : null,
    hasShipperLink: r.shipperTokenHash !== null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString()
  };
}

const ENDED: LoadStatus[] = ["delivered", "cancelled", "declined"];

export async function listLoads(organizationId: string, opts: { filter?: (typeof LOAD_LIST_FILTERS)[number]; q?: string } = {}, now = new Date()): Promise<LoadSummaryDto[]> {
  const l = schema.loads;
  const q = opts.q?.trim().slice(0, 80);
  const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const rows = await getDb()
    .select({ l, vehicleName: schema.vehicles.name })
    .from(l)
    .leftJoin(schema.vehicles, and(eq(schema.vehicles.id, l.vehicleId), eq(schema.vehicles.organizationId, l.organizationId)))
    .where(
      and(
        eq(l.organizationId, organizationId),
        opts.filter === "ended" ? inArray(l.status, ENDED) : opts.filter === "all" ? undefined : notInArray(l.status, ENDED),
        like ? or(ilike(l.reference, like), ilike(l.driverName, like), ilike(l.carrierName, like), ilike(l.pickupAddress, like), ilike(l.deliveryAddress, like), ilike(l.driverPhone, like), ilike(schema.vehicles.name, like)) : undefined
      )
    )
    .orderBy(desc(l.createdAt))
    .limit(300);
  return rows.map((r) => toLoadSummary(r.l, now, r.vehicleName));
}

async function loadRow(organizationId: string, id: string): Promise<LoadRow> {
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Load not found");
  const [row] = await getDb()
    .select()
    .from(schema.loads)
    .where(and(eq(schema.loads.id, id), eq(schema.loads.organizationId, organizationId)));
  if (!row) throw new NotFoundError("Load not found");
  return row;
}

export async function getLoad(organizationId: string, id: string, now = new Date()): Promise<LoadDetailDto> {
  const r = await loadRow(organizationId, id);
  const db = getDb();
  const e = schema.loadEvents;
  const p = schema.loadPings;
  const h = schema.locationHistory;
  const trailFrom = r.acceptedAt ?? r.createdAt;
  const trailTo = r.endedAt;
  const [events, pings, creator, vehicle] = await Promise.all([
    db
      .select({ type: e.type, at: e.at, latitude: e.latitude, longitude: e.longitude, actorName: schema.users.name })
      .from(e)
      .leftJoin(schema.users, eq(schema.users.id, e.actorUserId))
      .where(and(eq(e.loadId, r.id), eq(e.organizationId, organizationId)))
      .orderBy(asc(e.at), asc(e.id)),
    // Phone loads: the positions the driver sent. Vehicle loads: the vehicle's own track while the load ran.
    r.trackingMode === "vehicle" && r.vehicleId
      ? db
          .select({ lat: h.latitude, lon: h.longitude, t: h.recordedAt })
          .from(h)
          .where(and(eq(h.vehicleId, r.vehicleId), eq(h.organizationId, organizationId), gte(h.recordedAt, trailFrom), trailTo ? lte(h.recordedAt, trailTo) : undefined))
          .orderBy(desc(h.recordedAt))
          .limit(TRAIL_LIMIT)
      : db
          .select({ lat: p.latitude, lon: p.longitude, t: p.recordedAt })
          .from(p)
          .where(and(eq(p.loadId, r.id), eq(p.organizationId, organizationId)))
          .orderBy(desc(p.recordedAt))
          .limit(TRAIL_LIMIT),
    r.createdBy ? db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, r.createdBy)) : Promise.resolve([]),
    r.vehicleId ? db.select({ name: schema.vehicles.name }).from(schema.vehicles).where(and(eq(schema.vehicles.id, r.vehicleId), eq(schema.vehicles.organizationId, organizationId))) : Promise.resolve([])
  ]);
  return {
    ...toLoadSummary(r, now, vehicle[0]?.name ?? null),
    notes: r.notes,
    inviteSentAt: r.inviteSentAt?.toISOString() ?? null,
    acceptedAt: r.acceptedAt?.toISOString() ?? null,
    endedAt: r.endedAt?.toISOString() ?? null,
    createdByName: creator[0]?.name || null,
    events: events.map((ev) => ({ type: ev.type as LoadEventType, at: ev.at.toISOString(), actorName: ev.actorName || null, latitude: ev.latitude, longitude: ev.longitude })),
    trail: pings.reverse().map((pt) => [pt.lon, pt.lat, pt.t.getTime()]),
    smsAvailable: smsConfigured()
  };
}

const stopColumns = (k: "pickup" | "delivery", s: z.infer<typeof StopSchema>) => ({
  [`${k}Name`]: s.name,
  [`${k}Address`]: s.address,
  [`${k}Lat`]: s.latitude,
  [`${k}Lon`]: s.longitude,
  [`${k}RadiusM`]: s.radiusM,
  [`${k}AppointmentAt`]: s.appointmentAt
});

const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === "23505" || (err as { cause?: { code?: string } })?.cause?.code === "23505";

export function driverLink(token: string): string {
  return `${new URL(getServerEnv().AUTH_URL).origin}/d#${token}`;
}
export function shipperLink(token: string): string {
  return `${new URL(getServerEnv().AUTH_URL).origin}/track#${token}`;
}

/**
 * Text of the invite. Says who asks, for which load and when it stops. Automatic texts (Twilio)
 * also say how to opt out; a message the broker sends from their own phone or WhatsApp does not.
 */
export function inviteText(orgName: string, reference: string, link: string, opts: { optOut?: boolean } = {}): string {
  const base = `${orgName}: please share your location for load ${reference} while you haul it. Open ${link} to accept. Tracking ends when the load is delivered.`;
  return opts.optOut === false ? base : `${base} Reply STOP to opt out.`;
}

/** What the broker's own WhatsApp / Messages app needs to send the link: the number and the text. */
export interface DriverShare {
  phone: string | null;
  message: string;
}

async function orgName(organizationId: string): Promise<string> {
  const [o] = await getDb().select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, organizationId));
  return o?.name ?? "Your broker";
}

async function addEvent(organizationId: string, loadId: string, type: LoadEventType, actorUserId: string | null, at = new Date(), detail: Record<string, unknown> | null = null) {
  await getDb().insert(schema.loadEvents).values({ organizationId, loadId, type, actorUserId, at, detail });
}

async function textInvite(ctx: TenantContext, row: Pick<LoadRow, "id" | "reference" | "driverPhone">, link: string): Promise<SmsResult> {
  if (!row.driverPhone) return { sent: false, reason: "rejected", message: "This load has no driver mobile number." };
  await assertRateLimit("load_invite", row.id, INVITES_PER_LOAD_PER_HOUR, 3_600, "Too many invites for this load in the last hour. Copy the link and send it yourself.");
  const result = await sendSms(row.driverPhone, inviteText(await orgName(ctx.organizationId), row.reference, link, { optOut: true }));
  if (result.sent) {
    const now = new Date();
    await getDb().update(schema.loads).set({ inviteSentAt: now }).where(eq(schema.loads.id, row.id));
    await addEvent(ctx.organizationId, row.id, "invite_sent", ctx.userId, now, { channel: "sms" });
  }
  return result;
}

export interface CreatedLoad {
  id: string;
  /** Shown once. null for a load tracked by one of the organization's vehicles. */
  driverLink: string | null;
  /** null when no text was attempted (not requested or SMS not set up). */
  sms: SmsResult | null;
  /** For sending the link from the broker's own WhatsApp or Messages app. null with no driver link. */
  share: DriverShare | null;
}

/** The vehicle (same organization) and its tracker's latest fix, if any. */
async function vehicleForLoad(organizationId: string, vehicleId: string) {
  const db = getDb();
  const [v] = await db.select({ id: schema.vehicles.id }).from(schema.vehicles).where(and(eq(schema.vehicles.id, vehicleId), eq(schema.vehicles.organizationId, organizationId)));
  if (!v) throw new ValidationError("That vehicle was not found");
  const a = schema.deviceAssignments;
  const cl = schema.currentLocations;
  const [loc] = await db
    .select({ latitude: cl.latitude, longitude: cl.longitude, speedKph: cl.speedKph, recordedAt: cl.recordedAt })
    .from(a)
    .innerJoin(cl, and(eq(cl.deviceId, a.deviceId), eq(cl.organizationId, organizationId)))
    .where(and(eq(a.vehicleId, vehicleId), eq(a.organizationId, organizationId), isNull(a.unassignedAt)))
    .orderBy(desc(cl.recordedAt))
    .limit(1);
  return { loc: loc ?? null };
}

export async function createLoad(ctx: TenantContext, input: LoadInput, meta: Meta, now = new Date()): Promise<CreatedLoad> {
  const token = newToken();
  const byVehicle = input.trackingMode === "vehicle";
  // A vehicle-mode load is tracked from the start (the organization's own tracker, no consent step);
  // it starts from the tracker's current fix so the map isn't empty until the next report.
  const vehicle = byVehicle ? await vehicleForLoad(ctx.organizationId, input.vehicleId!) : null;
  let id: string;
  try {
    const [row] = await getDb()
      .insert(schema.loads)
      .values({
        organizationId: ctx.organizationId,
        reference: input.reference,
        carrierName: input.carrierName,
        driverName: input.driverName,
        driverPhone: input.driverPhone,
        trackingMode: input.trackingMode,
        vehicleId: byVehicle ? input.vehicleId : null,
        ...(byVehicle ? { status: "tracking" as const, acceptedAt: now } : {}),
        ...(vehicle?.loc ? { lastLat: vehicle.loc.latitude, lastLon: vehicle.loc.longitude, lastSpeedKph: vehicle.loc.speedKph, lastPositionAt: vehicle.loc.recordedAt } : {}),
        notes: input.notes,
        ...(stopColumns("pickup", input.pickup) as object),
        ...(stopColumns("delivery", input.delivery) as object),
        driverTokenHash: hashLoadToken(token),
        createdBy: ctx.userId,
        createdAt: now,
        updatedAt: now
      } as typeof schema.loads.$inferInsert)
      .returning({ id: schema.loads.id });
    id = row!.id;
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError(`Load ${input.reference} already exists`);
    throw err;
  }
  await addEvent(ctx.organizationId, id, "created", ctx.userId, now);
  await writeAudit({ action: "load.created", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "load", targetId: id, metadata: { reference: input.reference }, ...meta });
  if (byVehicle) return { id, driverLink: null, sms: null, share: null };
  const link = driverLink(token);
  const sms = input.sendInvite && smsConfigured() ? await textInvite(ctx, { id, reference: input.reference, driverPhone: input.driverPhone }, link) : null;
  return { id, driverLink: link, sms, share: { phone: input.driverPhone, message: inviteText(await orgName(ctx.organizationId), input.reference, link, { optOut: false }) } };
}

export async function updateLoad(ctx: TenantContext, id: string, patch: z.infer<typeof LoadPatchSchema>, meta: Meta, now = new Date()): Promise<void> {
  const row = await loadRow(ctx.organizationId, id);
  if (isLoadEnded(row.status)) throw new ValidationError("This load has ended and can no longer be changed");
  if (row.trackingMode === "phone" && patch.driverPhone === null) throw new ValidationError("A load tracked by phone needs the driver's mobile number");
  if (patch.vehicleId !== undefined) {
    if (row.trackingMode !== "vehicle") throw new ValidationError("This load is tracked by the driver's phone");
    await vehicleForLoad(ctx.organizationId, patch.vehicleId);
  }
  const set: Record<string, unknown> = { updatedAt: now };
  if (patch.vehicleId !== undefined) set.vehicleId = patch.vehicleId;
  for (const k of ["reference", "carrierName", "driverName", "driverPhone", "notes"] as const) if (patch[k] !== undefined) set[k] = patch[k];
  if (patch.pickup) Object.assign(set, stopColumns("pickup", patch.pickup));
  if (patch.delivery) Object.assign(set, stopColumns("delivery", patch.delivery));
  try {
    await getDb()
      .update(schema.loads)
      .set(set)
      .where(and(eq(schema.loads.id, id), eq(schema.loads.organizationId, ctx.organizationId)));
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError(`Load ${patch.reference} already exists`);
    throw err;
  }
  await addEvent(ctx.organizationId, id, "updated", ctx.userId, now, { fields: Object.keys(patch) });
  await writeAudit({ action: "load.updated", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "load", targetId: id, metadata: { fields: Object.keys(patch) }, ...meta });
}

/**
 * A new driver link (the old one stops working at once) and, when asked and available,
 * a text message with it. The driver keeps their consent if they had already accepted;
 * they only need to open the new link.
 */
export async function reissueDriverLink(ctx: TenantContext, id: string, opts: { send: boolean }, meta: Meta): Promise<{ driverLink: string; sms: SmsResult | null; share: DriverShare }> {
  const row = await loadRow(ctx.organizationId, id);
  if (isLoadEnded(row.status)) throw new ValidationError("This load has ended");
  if (row.trackingMode !== "phone") throw new ValidationError("This load is tracked by a vehicle's tracker, not the driver's phone");
  const token = newToken();
  await getDb()
    .update(schema.loads)
    .set({ driverTokenHash: hashLoadToken(token), updatedAt: new Date() })
    .where(and(eq(schema.loads.id, id), eq(schema.loads.organizationId, ctx.organizationId)));
  await writeAudit({ action: "load.driver_link_reissued", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "load", targetId: id, metadata: { send: opts.send }, ...meta });
  const link = driverLink(token);
  const sms = opts.send ? await textInvite(ctx, row, link) : null;
  return { driverLink: link, sms, share: { phone: row.driverPhone, message: inviteText(await orgName(ctx.organizationId), row.reference, link, { optOut: false }) } };
}

/** Ends a load by hand. Tracking stops; the driver link stops accepting positions. */
export async function setLoadOutcome(ctx: TenantContext, id: string, action: z.infer<typeof LoadActionSchema>["action"], meta: Meta, now = new Date()): Promise<void> {
  const row = await loadRow(ctx.organizationId, id);
  if (isLoadEnded(row.status)) throw new ValidationError("This load has already ended");
  const status: LoadStatus = action === "delivered" ? "delivered" : "cancelled";
  const [updated] = await getDb()
    .update(schema.loads)
    .set({ status, endedAt: now, updatedAt: now })
    .where(and(eq(schema.loads.id, id), eq(schema.loads.organizationId, ctx.organizationId), notInArray(schema.loads.status, ENDED)))
    .returning({ id: schema.loads.id });
  if (!updated) throw new ValidationError("This load has already ended");
  await addEvent(ctx.organizationId, id, action === "delivered" ? "delivered" : "cancelled", ctx.userId, now, { manual: true });
  await writeAudit({ action: `load.${status}`, actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "load", targetId: id, ...meta });
}

/** Deletes the load with all its positions and timeline. */
export async function deleteLoad(ctx: TenantContext, id: string, meta: Meta): Promise<void> {
  const row = await loadRow(ctx.organizationId, id);
  await getDb()
    .delete(schema.loads)
    .where(and(eq(schema.loads.id, id), eq(schema.loads.organizationId, ctx.organizationId)));
  await writeAudit({ action: "load.deleted", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "load", targetId: id, metadata: { reference: row.reference }, ...meta });
}

/** A new shipper link (replacing any earlier one). Returned once. */
export async function createShipperLink(ctx: TenantContext, id: string, meta: Meta): Promise<{ shipperLink: string }> {
  const row = await loadRow(ctx.organizationId, id);
  if (row.status === "cancelled" || row.status === "declined") throw new ValidationError("This load was not hauled");
  const token = newToken();
  await getDb()
    .update(schema.loads)
    .set({ shipperTokenHash: hashLoadToken(token), updatedAt: new Date() })
    .where(and(eq(schema.loads.id, id), eq(schema.loads.organizationId, ctx.organizationId)));
  await writeAudit({ action: "load.shipper_link_created", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "load", targetId: id, ...meta });
  return { shipperLink: shipperLink(token) };
}

export async function revokeShipperLink(ctx: TenantContext, id: string, meta: Meta): Promise<void> {
  await loadRow(ctx.organizationId, id);
  await getDb()
    .update(schema.loads)
    .set({ shipperTokenHash: null, updatedAt: new Date() })
    .where(and(eq(schema.loads.id, id), eq(schema.loads.organizationId, ctx.organizationId)));
  await writeAudit({ action: "load.shipper_link_revoked", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "load", targetId: id, ...meta });
}

/** Counts for the list header. */
export async function loadCounts(organizationId: string): Promise<Record<"active" | "ended", number>> {
  const l = schema.loads;
  const [c] = await getDb()
    .select({
      active: sql<number>`count(*) filter (where ${l.status} not in ('delivered','cancelled','declined'))::int`,
      ended: sql<number>`count(*) filter (where ${l.status} in ('delivered','cancelled','declined'))::int`
    })
    .from(l)
    .where(eq(l.organizationId, organizationId));
  return { active: c?.active ?? 0, ended: c?.ended ?? 0 };
}

export { LOAD_STATUSES };
